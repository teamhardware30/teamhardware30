import { boolean, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, updatedAtColumn } from './columns';
import { seekerProfiles } from './profiles.schema';

export const skills = pgTable('skills', {
  id: idColumn(),
  name: text('name').notNull().unique(),
  aliases: text('aliases').array().notNull().default([]),
  category: text('category'),
  needsReview: boolean('needs_review').notNull().default(false),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const profileSkills = pgTable(
  'profile_skills',
  {
    id: idColumn(),
    profileId: uuid('profile_id').notNull().references(() => seekerProfiles.id, { onDelete: 'cascade' }),
    skillId: uuid('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
    level: text('level'),
    years: text('years'),
    createdAt: createdAtColumn(),
  },
  (table) => ({
    profileSkillUnique: unique().on(table.profileId, table.skillId),
  }),
);

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;
export type ProfileSkill = typeof profileSkills.$inferSelect;
export type NewProfileSkill = typeof profileSkills.$inferInsert;
