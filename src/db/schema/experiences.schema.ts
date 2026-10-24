import { pgTable, uuid, text, date, boolean, integer, timestamp } from 'drizzle-orm/pg-core';
import { seekerProfiles } from './profiles.schema';

export const experiences = pgTable('experiences', {
  id: uuid('id').primaryKey().defaultRandom(),
  profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
  company: text('company').notNull(),
  title: text('title').notNull(),
  location: text('location'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  current: boolean('current').notNull().default(false),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;
