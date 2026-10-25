import { date, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { seekerProfiles } from './profiles.schema';

export const educations = pgTable('educations', {
  id: idColumn(),
  profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
  school: text('school').notNull(),
  degree: text('degree'),
  fieldOfStudy: text('field_of_study'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export type Education = typeof educations.$inferSelect;
export type NewEducation = typeof educations.$inferInsert;
