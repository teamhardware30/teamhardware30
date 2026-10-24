import { pgTable, uuid, text, timestamp, jsonb, customType, pgEnum } from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .filter(Boolean)
      .map(Number);
  },
});

export const jobStatusEnum = pgEnum('job_status', ['active', 'expired', 'removed']);

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceUrl: text('source_url').notNull().unique(),
  sourceName: text('source_name').notNull(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  descriptionHtml: text('description_html').notNull(),
  descriptionText: text('description_text').notNull(),
  skills: jsonb('skills').$type<string[]>().notNull().default([]),
  embedding: vector('embedding'),
  status: jobStatusEnum('status').notNull().default('active'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  crawledAt: timestamp('crawled_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
