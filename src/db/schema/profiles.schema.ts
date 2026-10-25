import { pgTable, uuid, text, timestamp, integer, boolean, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users.schema';
import { vector } from './vector';

export const parseStatusEnum = pgEnum('parse_status', ['pending', 'processing', 'done', 'failed']);

export const seekerProfiles = pgTable('seeker_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  headline: text('headline'),
  summary: text('summary'),
  desiredTitles: text('desired_titles').array().notNull().default([]),
  locations: text('locations').array().notNull().default([]),
  remote: boolean('remote').notNull().default(false),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency').notNull().default('KES'),
  jobTypes: text('job_types').array().notNull().default([]),
  parseStatus: parseStatusEnum('parse_status').notNull().default('pending'),
  parseError: text('parse_error'),
  embedding: vector('embedding'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type SeekerProfile = typeof seekerProfiles.$inferSelect;
export type NewSeekerProfile = typeof seekerProfiles.$inferInsert;
