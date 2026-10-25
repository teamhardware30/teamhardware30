import { index, jsonb, pgTable, real, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { jobs } from './jobs.schema';
import { seekerProfiles } from './profiles.schema';
import { resumes } from './resumes.schema';

export const atsScans = pgTable(
  'ats_scans',
  {
    id: idColumn(),
    profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
    resumeId: uuid('resume_id').notNull().references(() => resumes.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    score: real('score').notNull(),
    keywordHits: jsonb('keyword_hits').$type<Record<string, unknown>[]>().notNull().default([]),
    keywordGaps: jsonb('keyword_gaps').$type<Record<string, unknown>[]>().notNull().default([]),
    formatIssues: jsonb('format_issues').$type<Record<string, unknown>[]>().notNull().default([]),
    suggestions: jsonb('suggestions').$type<Record<string, unknown>[]>().notNull().default([]),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    profileCreatedIndex: index('ats_scans_profile_created_idx').on(table.profileId, table.createdAt),
  }),
);

export type AtsScan = typeof atsScans.$inferSelect;
export type NewAtsScan = typeof atsScans.$inferInsert;
