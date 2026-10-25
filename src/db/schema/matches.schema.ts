import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgEnum, pgTable, real, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { jobs } from './jobs.schema';
import { seekerProfiles } from './profiles.schema';

export const matchStatusEnum = pgEnum('match_status', ['new', 'saved', 'hidden', 'applied']);

export const matches = pgTable(
  'matches',
  {
    id: idColumn(),
    profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    score: real('score').notNull(),
    breakdown: jsonb('breakdown').$type<Record<string, number>>().notNull().default({}),
    explanation: jsonb('explanation').$type<Record<string, unknown>>(),
    status: matchStatusEnum('status').notNull().default('new'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    profileJobUnique: unique().on(table.profileId, table.jobId),
    profileScoreIndex: index('job_matches_profile_score_idx').on(table.profileId, table.score),
    scoreRange: check('job_matches_score_range', sql`${table.score} between 0 and 100`),
  }),
);

export type MatchRow = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
