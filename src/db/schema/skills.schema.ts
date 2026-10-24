import { pgTable, uuid, text, timestamp, boolean, unique } from 'drizzle-orm/pg-core';
import { seekerProfiles } from './profiles.schema';

export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  aliases: text('aliases').array().notNull().default([]),
  needsReview: boolean('needs_review').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const profileSkills = pgTable(
  'profile_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileSkillUnique: unique().on(table.profileId, table.skillId),
  }),
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type ProfileSkill = typeof profileSkills.$inferSelect;
export type NewProfileSkill = typeof profileSkills.$inferInsert;
