import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { users } from './users.schema';
import { vector } from './vector';

export const parseStatusEnum = pgEnum('parse_status', ['pending', 'processing', 'done', 'failed']);

export const seekerProfiles = pgTable('seeker_profiles', {
  id: idColumn(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  headline: text('headline'),
  summary: text('summary'),
  location: text('location'),
  remote: boolean('remote').notNull().default(false),
  remotePref: boolean('remote_pref').notNull().default(false),
  desiredTitles: text('desired_titles').array().notNull().default([]),
  locations: text('locations').array().notNull().default([]),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  salaryCurrency: text('salary_currency').notNull().default('KES'),
  jobTypes: text('job_types').array().notNull().default([]),
  yearsExperience: integer('years_experience'),
  seniority: text('seniority'),
  openToRelocate: boolean('open_to_relocate').notNull().default(false),
  onboardingStep: integer('onboarding_step').notNull().default(1),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  lastMatchesViewedAt: timestamp('last_matches_viewed_at', { withTimezone: true }),
  parseStatus: parseStatusEnum('parse_status').notNull().default('pending'),
  applyConsent: jsonb('apply_consent').$type<Record<string, boolean>>().notNull().default({}),
  parseError: text('parse_error'),
  embedding: vector('embedding'),
  embeddingTextHash: text('embedding_text_hash'),
  embeddingModel: text('embedding_model'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type SeekerProfile = typeof seekerProfiles.$inferSelect;
export type NewSeekerProfile = typeof seekerProfiles.$inferInsert;
