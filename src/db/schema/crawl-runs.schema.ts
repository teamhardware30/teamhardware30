import { pgTable, uuid, text, timestamp, integer, pgEnum, index, jsonb } from 'drizzle-orm/pg-core';
import { sources } from './sources.schema';

export const crawlRunStatusEnum = pgEnum('crawl_run_status', ['running', 'success', 'partial', 'failed']);

export const crawlRuns = pgTable(
  'crawl_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    status: crawlRunStatusEnum('status').notNull().default('running'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    jobsFound: integer('jobs_found').notNull().default(0),
    jobsCreated: integer('jobs_created').notNull().default(0),
    jobsUpdated: integer('jobs_updated').notNull().default(0),
    jobsSkipped: integer('jobs_skipped').notNull().default(0),
    batchesTotal: integer('batches_total').notNull().default(0),
    batchesCompleted: integer('batches_completed').notNull().default(0),
    processedUpsertBatches: jsonb('processed_upsert_batches').$type<number[]>().notNull().default([]),
    processedDedupeBatches: jsonb('processed_dedupe_batches').$type<number[]>().notNull().default([]),
    errorCount: integer('error_count').notNull().default(0),
    errors: jsonb('errors').$type<CrawlItemError[]>().notNull().default([]),
    error: text('error'),
  },
  (table) => ({
    sourceStartedIdx: index('crawl_runs_source_started_idx').on(table.sourceId, table.startedAt),
  }),
);

export interface CrawlItemError {
  stage: 'fetch' | 'normalize' | 'upsert' | 'dedupe';
  reason: string;
  sourceUrl?: string;
  externalId?: string;
  at: string;
}

export type CrawlRun = typeof crawlRuns.$inferSelect;
export type NewCrawlRun = typeof crawlRuns.$inferInsert;
