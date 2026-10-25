import { pgTable, uuid, text, timestamp, jsonb, boolean, pgEnum } from 'drizzle-orm/pg-core';

export const sourceKindEnum = pgEnum('source_kind', [
  'greenhouse',
  'lever',
  'ashby',
  'remotive',
  'arbeitnow',
  'jsonld',
  'html',
]);

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: sourceKindEnum('kind').notNull(),
  baseUrl: text('base_url').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  cron: text('cron').notNull().default('0 */6 * * *'),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastRunStatus: text('last_run_status'),
  lastRunMessage: text('last_run_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
