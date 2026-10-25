import { jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { jobs } from './jobs.schema';
import { seekerProfiles } from './profiles.schema';
import { resumes } from './resumes.schema';

export const applicationStatusEnum = pgEnum('application_status', [
  'draft',
  'submitted',
  'failed',
  'viewed',
  'interview',
  'rejected',
  'offer',
]);
export const applicationChannelEnum = pgEnum('application_channel', ['onsite', 'email', 'external_ats']);

export const applications = pgTable(
  'applications',
  {
    id: idColumn(),
    profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    status: applicationStatusEnum('status').notNull().default('draft'),
    channel: applicationChannelEnum('channel').notNull(),
    coverLetter: text('cover_letter'),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    events: jsonb('events').$type<Record<string, unknown>[]>().notNull().default([]),
    failureReason: text('failure_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => ({
    profileJobUnique: unique().on(table.profileId, table.jobId),
  }),
);

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
