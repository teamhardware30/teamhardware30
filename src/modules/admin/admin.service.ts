import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { SQL} from 'drizzle-orm';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { CrawlItemError, CrawlRun, Source } from '../../db/schema';
import { crawlRuns, jobs, sources } from '../../db/schema';
import { CRAWL_SOURCE_QUEUE, ENRICH_JOB_QUEUE, STALE_AFTER_DAYS } from '../crawler/crawler.constants';
import { CrawlSourceJobData } from '../crawler/crawler.scheduler';
import { CrawlerScheduler } from '../crawler/crawler.scheduler';
import { CrawlerService } from '../crawler/crawler.service';
import { JobsService } from '../jobs/jobs.service';

export interface CrawlRunRow {
  id: string;
  sourceId: string;
  status: CrawlRun['status'];
  startedAt: Date;
  finishedAt: Date | null;
  jobsFound: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsSkipped: number;
  batchesTotal: number;
  batchesCompleted: number;
  errorCount: number;
  errors: CrawlItemError[];
  error: string | null;
  sourceName: string | null;
  durationSeconds: number | null;
}

export interface AdminSourceRow extends Source {
  latestRun: CrawlRunRow | null;
}

export interface CrawlRunFilters {
  sourceId?: string;
  status?: CrawlRun['status'];
  page?: number;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crawlerService: CrawlerService,
    private readonly crawlerScheduler: CrawlerScheduler,
    private readonly jobsService: JobsService,
    @InjectQueue(CRAWL_SOURCE_QUEUE) private readonly crawlQueue: Queue<CrawlSourceJobData>,
    @InjectQueue(ENRICH_JOB_QUEUE) private readonly enrichQueue: Queue<{ jobId: string }>,
  ) {}

  async listSources(): Promise<AdminSourceRow[]> {
    const rows = await this.crawlerService.listSources();
    return Promise.all(
      rows.map(async (source) => ({
        ...source,
        latestRun: (await this.listCrawlRuns(1, source.id))[0] ?? null,
      })),
    );
  }

  async toggleSource(sourceId: string): Promise<Source> {
    const source = await this.crawlerService.findSource(sourceId);
    if (!source) throw new NotFoundException('Source not found');
    const [updated] = await this.db
      .update(sources)
      .set({ enabled: !source.enabled, updatedAt: new Date() })
      .where(eq(sources.id, sourceId))
      .returning();
    await this.crawlerScheduler.syncSchedulers();
    return updated;
  }

  async toggleKillSwitch(sourceId: string): Promise<Source> {
    const source = await this.crawlerService.findSource(sourceId);
    if (!source) throw new NotFoundException('Source not found');
    const [updated] = await this.db
      .update(sources)
      .set({ killSwitch: !source.killSwitch, updatedAt: new Date() })
      .where(eq(sources.id, sourceId))
      .returning();
    return updated;
  }

  async runNow(sourceId: string): Promise<void> {
    const source = await this.crawlerService.findSource(sourceId);
    if (!source) throw new NotFoundException('Source not found');
    if (source.killSwitch) throw new BadRequestException('Disable the source kill switch before running it');
    await this.crawlQueue.add(
      'crawl-source',
      { sourceId, force: true },
      {
        // Dedupe waiting/active manual runs, but allow a later run after completion.
        jobId: `manual-${sourceId}`,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    );
  }

  async reEnrichJob(jobId: string): Promise<void> {
    await this.enrichQueue.add('enrich-job', { jobId }, { jobId: `enrich-job-${jobId}`, removeOnComplete: true, removeOnFail: false });
  }

  async reEnrichJobs(from: Date, to: Date, limit: number): Promise<number> {
    const jobs = await this.jobsService.findJobsForReenrichment(from, to, limit);
    await Promise.all(jobs.map((job) => this.reEnrichJob(job.id)));
    return jobs.length;
  }

  async listCrawlRuns(limit = 100, sourceId?: string): Promise<CrawlRunRow[]> {
    const rows = await this.baseRunQuery()
      .where(sourceId ? eq(crawlRuns.sourceId, sourceId) : undefined)
      .orderBy(desc(crawlRuns.startedAt))
      .limit(limit);
    return rows.map((row) => this.mapRun(row));
  }

  async listCrawlRunsPage(filters: CrawlRunFilters = {}) {
    const pageSize = 50;
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const conditions: SQL[] = [];
    if (filters.sourceId) conditions.push(eq(crawlRuns.sourceId, filters.sourceId));
    if (filters.status) conditions.push(eq(crawlRuns.status, filters.status));

    const rows = await this.baseRunQuery()
      .where(and(...conditions))
      .orderBy(desc(crawlRuns.startedAt), desc(crawlRuns.id))
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize);
    const runs = rows.slice(0, pageSize).map((row) => this.mapRun(row));
    return {
      runs,
      page,
      pageSize,
      hasNext: rows.length > pageSize,
      filters: { sourceId: filters.sourceId, status: filters.status },
      sources: await this.crawlerService.listSources(),
    };
  }

  async jobMetrics(now = new Date()): Promise<{ active: number; expired: number; stale: number; inactive: number }> {
    const staleCutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const [row] = await this.db
      .select({
        active: sql<number>`count(*) filter (where ${jobs.isActive})::int`,
        inactive: sql<number>`count(*) filter (where not ${jobs.isActive})::int`,
        expired: sql<number>`count(*) filter (where ${jobs.expiresAt} <= ${now})::int`,
        stale: sql<number>`count(*) filter (where ${jobs.lastSeenAt} < ${staleCutoff})::int`,
      })
      .from(jobs);
    return {
      active: Number(row?.active ?? 0),
      inactive: Number(row?.inactive ?? 0),
      expired: Number(row?.expired ?? 0),
      stale: Number(row?.stale ?? 0),
    };
  }

  private baseRunQuery() {
    return this.db
      .select({
        id: crawlRuns.id,
        sourceId: crawlRuns.sourceId,
        status: crawlRuns.status,
        startedAt: crawlRuns.startedAt,
        finishedAt: crawlRuns.finishedAt,
        jobsFound: crawlRuns.jobsFound,
        jobsCreated: crawlRuns.jobsCreated,
        jobsUpdated: crawlRuns.jobsUpdated,
        jobsSkipped: crawlRuns.jobsSkipped,
        batchesTotal: crawlRuns.batchesTotal,
        batchesCompleted: crawlRuns.batchesCompleted,
        errorCount: crawlRuns.errorCount,
        errors: crawlRuns.errors,
        error: crawlRuns.error,
        sourceName: sources.name,
      })
      .from(crawlRuns)
      .leftJoin(sources, eq(crawlRuns.sourceId, sources.id));
  }

  private mapRun(row: Omit<CrawlRunRow, 'durationSeconds'>): CrawlRunRow {
    return {
      ...row,
      durationSeconds: row.finishedAt
        ? Math.max(0, Math.round((row.finishedAt.getTime() - row.startedAt.getTime()) / 1000))
        : null,
    };
  }
}
