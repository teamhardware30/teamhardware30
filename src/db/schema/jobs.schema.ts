import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { vector, tsvector } from './vector';
import { companies } from './companies.schema';
import { categories } from './categories.schema';
import { sources } from './sources.schema';

export const applyMethodEnum = pgEnum('apply_method', ['onsite', 'email', 'external_ats']);

// Retained so existing migrations stay stable; no longer used by the jobs table.
export const jobStatusEnum = pgEnum('job_status', ['active', 'expired', 'removed']);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    companyId: uuid('company_id').references(() => companies.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),

    externalId: text('external_id'),
    fingerprint: text('fingerprint').notNull().unique(),
    sourceUrl: text('source_url').notNull(),
    applyUrl: text('apply_url'),

    title: text('title').notNull(),
    company: text('company').notNull(),
    location: text('location'),
    city: text('city'),
    country: text('country'),
    remote: boolean('remote').notNull().default(false),
    employmentType: text('employment_type'),

    descriptionHtml: text('description_html').notNull(),
    descriptionText: text('description_text').notNull(),
    skills: jsonb('skills').$type<string[]>().notNull().default([]),

    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    salaryCurrency: text('salary_currency'),
    salaryPeriod: text('salary_period'),

    applyMethod: applyMethodEnum('apply_method').notNull().default('external_ats'),
    applyEmail: text('apply_email'),

    embedding: vector('embedding'),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(company, '') || ' ' || coalesce(description_text, ''))`,
    ),

    isActive: boolean('is_active').notNull().default(true),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    crawledAt: timestamp('crawled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceExternalUnique: uniqueIndex('jobs_source_external_unique')
      .on(table.sourceId, table.externalId)
      .where(sql`${table.externalId} is not null`),
    searchVectorIdx: index('jobs_search_vector_idx').using('gin', table.searchVector),
    embeddingIdx: index('jobs_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    titleTrgmIdx: index('jobs_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops')),
    companyIdx: index('jobs_company_idx').on(table.company),
    activePostedIdx: index('jobs_active_posted_idx').on(table.isActive, table.postedAt),
    sourceIdx: index('jobs_source_idx').on(table.sourceId),
  }),
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
