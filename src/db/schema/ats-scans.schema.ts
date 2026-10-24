import { pgTable, uuid, timestamp, real, jsonb } from 'drizzle-orm/pg-core';
import { seekerProfiles } from './profiles.schema';
import { jobs } from './jobs.schema';

export const atsScans = pgTable('ats_scans', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  score: real('score').notNull(),
  matchedKeywords: jsonb('matched_keywords').$type<string[]>().notNull().default([]),
  missingKeywords: jsonb('missing_keywords').$type<string[]>().notNull().default([]),
  suggestions: jsonb('suggestions').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AtsScan = typeof atsScans.$inferSelect;
export type NewAtsScan = typeof atsScans.$inferInsert;
