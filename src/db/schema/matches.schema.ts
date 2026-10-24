import { pgTable, uuid, timestamp, real, jsonb, unique } from 'drizzle-orm/pg-core';
import { seekerProfiles } from './profiles.schema';
import { jobs } from './jobs.schema';

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    reasons: jsonb('reasons').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileJobUnique: unique().on(table.profileId, table.jobId),
  }),
);

export type MatchRow = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
