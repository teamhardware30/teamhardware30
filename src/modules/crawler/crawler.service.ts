import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { companies, categories, crawlRuns, jobs, sources, CrawlRun, Source, NewCrawlRun } from '../../db/schema';
import { normalizeText } from './crawler.utils';

export type CrawlRunStatus = CrawlRun['status'];

export interface RunCounts {
  found?: number;
  created?: number;
  updated?: number;
  skipped?: number;
}

function slugify(value: string): string {
  const slug = normalizeText(value).replace(/\s+/g, '-');
  return slug || 'unknown';
}

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);
  private readonly companyCache = new Map<string, string>();
  private readonly categoryCache = new Map<string, string>();

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findSource(sourceId: string): Promise<Source | null> {
    return (await this.db.query.sources.findFirst({ where: eq(sources.id, sourceId) })) ?? null;
  }

  async listEnabledSources(): Promise<Source[]> {
    return this.db.query.sources.findMany({ where: eq(sources.enabled, true) });
  }

  async listSources(): Promise<Source[]> {
    return this.db.query.sources.findMany({ orderBy: (table, { asc }) => [asc(table.name)] });
  }

  async startRun(sourceId: string): Promise<CrawlRun> {
    const values: NewCrawlRun = { sourceId, status: 'running' };
    const [run] = await this.db.insert(crawlRuns).values(values).returning();
    return run;
  }

  async incrementRun(runId: string, counts: RunCounts): Promise<void> {
    if (!counts.found && !counts.created && !counts.updated && !counts.skipped) {
      return;
    }
    await this.db
      .update(crawlRuns)
      .set({
        jobsFound: sql`${crawlRuns.jobsFound} + ${counts.found ?? 0}`,
        jobsCreated: sql`${crawlRuns.jobsCreated} + ${counts.created ?? 0}`,
        jobsUpdated: sql`${crawlRuns.jobsUpdated} + ${counts.updated ?? 0}`,
        jobsSkipped: sql`${crawlRuns.jobsSkipped} + ${counts.skipped ?? 0}`,
      })
      .where(eq(crawlRuns.id, runId));
  }

  async finishRun(runId: string, status: CrawlRunStatus, error?: string): Promise<void> {
    await this.db
      .update(crawlRuns)
      .set({ status, finishedAt: new Date(), error: error ?? null })
      .where(eq(crawlRuns.id, runId));
  }

  async markSourceRun(sourceId: string, status: string, message?: string): Promise<void> {
    await this.db
      .update(sources)
      .set({ lastRunAt: new Date(), lastRunStatus: status, lastRunMessage: message ?? null, updatedAt: new Date() })
      .where(eq(sources.id, sourceId));
  }

  async resolveCompanyId(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) {
      return null;
    }
    const slug = slugify(trimmed);
    const cached = this.companyCache.get(slug);
    if (cached) {
      return cached;
    }

    const existing = await this.db.query.companies.findFirst({ where: eq(companies.slug, slug) });
    if (existing) {
      this.companyCache.set(slug, existing.id);
      return existing.id;
    }

    const [inserted] = await this.db
      .insert(companies)
      .values({ name: trimmed, slug })
      .onConflictDoNothing({ target: companies.slug })
      .returning();
    const id =
      inserted?.id ?? (await this.db.query.companies.findFirst({ where: eq(companies.slug, slug) }))?.id ?? null;
    if (id) {
      this.companyCache.set(slug, id);
    }
    return id;
  }

  async resolveCategoryId(name: string | undefined): Promise<string | null> {
    if (!name?.trim()) {
      return null;
    }
    const trimmed = name.trim();
    const slug = slugify(trimmed);
    const cached = this.categoryCache.get(slug);
    if (cached) {
      return cached;
    }

    const existing = await this.db.query.categories.findFirst({ where: eq(categories.slug, slug) });
    if (existing) {
      this.categoryCache.set(slug, existing.id);
      return existing.id;
    }

    const [inserted] = await this.db
      .insert(categories)
      .values({ name: trimmed, slug })
      .onConflictDoNothing({ target: categories.slug })
      .returning();
    const id =
      inserted?.id ?? (await this.db.query.categories.findFirst({ where: eq(categories.slug, slug) }))?.id ?? null;
    if (id) {
      this.categoryCache.set(slug, id);
    }
    return id;
  }

  async findJobById(jobId: string) {
    return (await this.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) })) ?? null;
  }

  async deactivateStaleJobs(days: number): Promise<number> {
    const stale = await this.db
      .update(jobs)
      .set({ isActive: false, updatedAt: new Date() })
      .where(sql`${jobs.isActive} = true and ${jobs.lastSeenAt} < now() - interval '${sql.raw(String(days))} days'`)
      .returning({ id: jobs.id });
    this.logger.log(`Deactivated ${stale.length} stale jobs`);
    return stale.length;
  }
}
