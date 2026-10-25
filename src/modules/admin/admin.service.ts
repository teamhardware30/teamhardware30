import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { desc, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { crawlRuns, sources, Source } from '../../db/schema';
import { CrawlerService } from '../crawler/crawler.service';
import { CrawlerScheduler, CrawlSourceJobData } from '../crawler/crawler.scheduler';
import { CRAWL_SOURCE_QUEUE } from '../crawler/crawler.constants';

export interface CrawlRunRow {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  jobsFound: number;
  jobsCreated: number;
  jobsUpdated: number;
  jobsSkipped: number;
  error: string | null;
  sourceName: string | null;
  durationSeconds: number | null;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crawlerService: CrawlerService,
    private readonly crawlerScheduler: CrawlerScheduler,
    @InjectQueue(CRAWL_SOURCE_QUEUE) private readonly crawlQueue: Queue<CrawlSourceJobData>,
  ) {}

  async listSources(): Promise<Source[]> {
    return this.crawlerService.listSources();
  }

  async toggleSource(sourceId: string): Promise<Source> {
    const source = await this.crawlerService.findSource(sourceId);
    if (!source) {
      throw new NotFoundException('Source not found');
    }
    const [updated] = await this.db
      .update(sources)
      .set({ enabled: !source.enabled, updatedAt: new Date() })
      .where(eq(sources.id, sourceId))
      .returning();
    await this.crawlerScheduler.syncSchedulers();
    return updated;
  }

  async runNow(sourceId: string): Promise<void> {
    const source = await this.crawlerService.findSource(sourceId);
    if (!source) {
      throw new NotFoundException('Source not found');
    }
    await this.crawlQueue.add(
      'crawl-source',
      { sourceId, force: true },
      { removeOnComplete: 100, removeOnFail: 500, attempts: 1 },
    );
  }

  async listCrawlRuns(limit = 100): Promise<CrawlRunRow[]> {
    const rows = await this.db
      .select({
        id: crawlRuns.id,
        status: crawlRuns.status,
        startedAt: crawlRuns.startedAt,
        finishedAt: crawlRuns.finishedAt,
        jobsFound: crawlRuns.jobsFound,
        jobsCreated: crawlRuns.jobsCreated,
        jobsUpdated: crawlRuns.jobsUpdated,
        jobsSkipped: crawlRuns.jobsSkipped,
        error: crawlRuns.error,
        sourceName: sources.name,
      })
      .from(crawlRuns)
      .leftJoin(sources, eq(crawlRuns.sourceId, sources.id))
      .orderBy(desc(crawlRuns.startedAt))
      .limit(limit);
    return rows.map((row) => ({
      ...row,
      durationSeconds: row.finishedAt
        ? Math.max(0, Math.round((row.finishedAt.getTime() - row.startedAt.getTime()) / 1000))
        : null,
    }));
  }
}
