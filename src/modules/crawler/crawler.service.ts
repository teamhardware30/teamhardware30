import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import {
  CrawlItemError,
  CrawlRun,
  Job,
  Source,
  NewCrawlRun} from '../../db/schema';
import {
  companies,
  categories,
  crawlRuns,
  jobs,
  sources
} from '../../db/schema';
import { LINK_CHECK_INTERVAL_DAYS, STALE_AFTER_DAYS } from './crawler.constants';
import { normalizeText } from './crawler.utils';

export type CrawlRunStatus = CrawlRun['status'];
export type NewRunItemError = Omit<CrawlItemError, 'at'> & { at?: string };

export interface RunCounts {
  found?: number;
  created?: number;
  updated?: number;
  skipped?: number;
}

function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, '-') || 'unknown';
}

function safeReason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
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
    return this.db.query.sources.findMany({ orderBy: (table, { asc: ascending }) => [ascending(table.name)] });
  }

  async startRun(sourceId: string): Promise<CrawlRun> {
    const values: NewCrawlRun = { sourceId, status: 'running' };
    const [run] = await this.db.insert(crawlRuns).values(values).returning();
    return run;
  }

  async findRun(runId: string): Promise<CrawlRun | null> {
    return (await this.db.query.crawlRuns.findFirst({ where: eq(crawlRuns.id, runId) })) ?? null;
  }

  async setRunBatches(runId: string, total: number): Promise<void> {
    await this.db.update(crawlRuns).set({ batchesTotal: total }).where(eq(crawlRuns.id, runId));
  }

  async incrementRun(runId: string, counts: RunCounts): Promise<void> {
    if (!counts.found && !counts.created && !counts.updated && !counts.skipped) return;
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

  /** Persist bounded per-item diagnostics; skipped/error counters remain exact. */
  async recordRunErrors(runId: string, entries: NewRunItemError[], countSkipped = true): Promise<void> {
    if (entries.length === 0) return;
    const normalized = entries.map((entry) => ({
      ...entry,
      reason: safeReason(entry.reason),
      sourceUrl: entry.sourceUrl?.slice(0, 2048),
      externalId: entry.externalId?.slice(0, 500),
      at: entry.at ?? new Date().toISOString(),
    }));
    const serialized = JSON.stringify(normalized);
    await this.db
      .update(crawlRuns)
      .set({
        errors: sql`case when jsonb_array_length(${crawlRuns.errors}) >= 500 then ${crawlRuns.errors} else ${crawlRuns.errors} || ${serialized}::jsonb end`,
        errorCount: sql`${crawlRuns.errorCount} + ${entries.length}`,
        jobsSkipped: sql`${crawlRuns.jobsSkipped} + ${countSkipped ? entries.length : 0}`,
        error: normalized[normalized.length - 1].reason,
      })
      .where(eq(crawlRuns.id, runId));
  }

  /** Mark upsert counters once even if a BullMQ batch is retried after enqueueing. */
  async markUpsertBatch(
    runId: string,
    batchIndex: number,
    counts: { created: number; updated: number },
  ): Promise<boolean> {
    const marker = JSON.stringify([batchIndex]);
    const rows = await this.db
      .update(crawlRuns)
      .set({
        processedUpsertBatches: sql`${crawlRuns.processedUpsertBatches} || ${marker}::jsonb`,
        jobsCreated: sql`${crawlRuns.jobsCreated} + ${counts.created}`,
        jobsUpdated: sql`${crawlRuns.jobsUpdated} + ${counts.updated}`,
      })
      .where(
        and(
          eq(crawlRuns.id, runId),
          sql`not ${crawlRuns.processedUpsertBatches} @> ${marker}::jsonb`,
        ),
      )
      .returning({ id: crawlRuns.id });
    return rows.length > 0;
  }

  /**
   * Complete exactly one dedupe batch. Atomic counter updates ensure a run cannot
   * finish until every batch is done, even when workers complete out of order.
   */
  async completeDedupeBatch(runId: string, sourceId: string, batchIndex: number, skipped: number): Promise<boolean> {
    const marker = JSON.stringify([batchIndex]);
    const rows = await this.db
      .update(crawlRuns)
      .set({
        processedDedupeBatches: sql`${crawlRuns.processedDedupeBatches} || ${marker}::jsonb`,
        batchesCompleted: sql`${crawlRuns.batchesCompleted} + 1`,
        jobsSkipped: sql`${crawlRuns.jobsSkipped} + ${skipped}`,
      })
      .where(
        and(
          eq(crawlRuns.id, runId),
          sql`not ${crawlRuns.processedDedupeBatches} @> ${marker}::jsonb`,
        ),
      )
      .returning();
    const run = rows[0];
    if (!run) return false;
    if (run.status !== 'running' || run.batchesTotal === 0 || run.batchesCompleted < run.batchesTotal) return true;

    const status: CrawlRunStatus = run.errorCount > 0 ? 'partial' : 'success';
    await this.finishRun(runId, status, run.error ?? undefined);
    await this.markSourceRun(sourceId, status, status === 'partial' ? `${run.errorCount} item error(s)` : undefined);
    return true;
  }

  async finishRun(runId: string, status: CrawlRunStatus, error?: string): Promise<void> {
    await this.db
      .update(crawlRuns)
      .set({ status, finishedAt: new Date(), error: error ?? null })
      .where(and(eq(crawlRuns.id, runId), eq(crawlRuns.status, 'running')));
  }

  async failRun(runId: string, sourceId: string, error: unknown): Promise<void> {
    const reason = safeReason(error);
    await this.finishRun(runId, 'failed', reason);
    await this.markSourceRun(sourceId, 'failed', reason);
  }

  async markSourceRun(sourceId: string, status: string, message?: string): Promise<void> {
    await this.db
      .update(sources)
      .set({ lastRunAt: new Date(), lastRunStatus: status, lastRunMessage: message ?? null, updatedAt: new Date() })
      .where(eq(sources.id, sourceId));
  }

  async resolveCompanyId(name: string): Promise<string | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const normalizedName = normalizeText(trimmed);
    const slug = normalizedName.replace(/\s+/g, '-') || 'unknown';
    const cached = this.companyCache.get(slug);
    if (cached) return cached;

    const existing = await this.db.query.companies.findFirst({ where: eq(companies.slug, slug) });
    if (existing) {
      this.companyCache.set(slug, existing.id);
      return existing.id;
    }

    const [inserted] = await this.db
      .insert(companies)
      .values({ name: trimmed, normalizedName, slug })
      .onConflictDoNothing({ target: companies.slug })
      .returning();
    const id =
      inserted?.id ?? (await this.db.query.companies.findFirst({ where: eq(companies.slug, slug) }))?.id ?? null;
    if (id) this.companyCache.set(slug, id);
    return id;
  }

  async resolveCategoryId(name: string | undefined): Promise<string | null> {
    if (!name?.trim()) return null;
    const trimmed = name.trim();
    const slug = slugify(trimmed);
    const cached = this.categoryCache.get(slug);
    if (cached) return cached;

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
    if (id) this.categoryCache.set(slug, id);
    return id;
  }

  async findJobById(jobId: string): Promise<Job | null> {
    return (await this.db.query.jobs.findFirst({ where: eq(jobs.id, jobId) })) ?? null;
  }

  /** Replace the old seven-day rule with expiry plus 45-days-unseen handling. */
  async deactivateExpiredAndStaleJobs(now = new Date()): Promise<{ expired: number; stale: number }> {
    const expired = await this.db
      .update(jobs)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(jobs.isActive, true), isNotNull(jobs.expiresAt), lte(jobs.expiresAt, now)))
      .returning({ id: jobs.id });

    const cutoff = new Date(now.getTime() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    const stale = await this.db
      .update(jobs)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(jobs.isActive, true), lt(jobs.lastSeenAt, cutoff)))
      .returning({ id: jobs.id });
    this.logger.log(`Deactivated ${expired.length} expired and ${stale.length} stale jobs`);
    return { expired: expired.length, stale: stale.length };
  }

  async listJobsDueForLinkCheck(now = new Date(), limit = 100): Promise<Job[]> {
    const cutoff = new Date(now.getTime() - LINK_CHECK_INTERVAL_DAYS * 24 * 60 * 60 * 1000);
    return this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.isActive, true),
          isNotNull(jobs.applyUrl),
          or(isNull(jobs.lastCheckedAt), lt(jobs.lastCheckedAt, cutoff)),
        ),
      )
      .orderBy(asc(jobs.lastCheckedAt), asc(jobs.id))
      .limit(limit);
  }

  async recordLinkCheck(jobId: string, dead: boolean, now = new Date()): Promise<void> {
    await this.db
      .update(jobs)
      .set({ lastCheckedAt: now, isActive: dead ? false : undefined, updatedAt: now })
      .where(eq(jobs.id, jobId));
  }
}
