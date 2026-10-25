import { boolean, integer, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { seekerProfiles } from './profiles.schema';

export const resumeSourceEnum = pgEnum('resume_source', ['upload', 'linkedin_pdf', 'linkedin_zip', 'generated']);

export const resumes = pgTable('resumes', {
  id: idColumn(),
  profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  s3Key: text('s3_key').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  isPrimary: boolean('is_primary').notNull().default(false),
  source: resumeSourceEnum('source').notNull().default('upload'),
  rawText: text('raw_text'),
  parsedJson: jsonb('parsed_json').$type<Record<string, unknown>>(),
  parseStatus: text('parse_status'),
  parseError: text('parse_error'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type Resume = typeof resumes.$inferSelect;
export type NewResume = typeof resumes.$inferInsert;
