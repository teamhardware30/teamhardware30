import { pgTable, uuid, timestamp, pgEnum, text } from 'drizzle-orm/pg-core';
import { seekerProfiles } from './profiles.schema';
import { jobs } from './jobs.schema';

export const applicationStatusEnum = pgEnum('application_status', [
  'queued',
  'submitted',
  'failed',
  'viewed',
  'rejected',
  'interviewing',
]);

export const applications = pgTable('applications', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  status: applicationStatusEnum('status').notNull().default('queued'),
  coverLetter: text('cover_letter'),
  failureReason: text('failure_reason'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
