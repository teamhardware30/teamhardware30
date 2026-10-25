import { boolean, date, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { seekerProfiles } from './profiles.schema';

export const experiences = pgTable('experiences', {
  id: idColumn(),
  profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  title: text('title').notNull(),
  location: text('location'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  current: boolean('current').notNull().default(false),
  description: text('description'),
  bullets: text('bullets').array().notNull().default([]),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
