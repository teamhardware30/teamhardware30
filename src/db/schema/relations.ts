import { relations } from 'drizzle-orm';
import { users } from './users.schema';
import { accounts } from './accounts.schema';
import { seekerProfiles } from './profiles.schema';
import { experiences } from './experiences.schema';
import { educations } from './educations.schema';
import { skills, profileSkills } from './skills.schema';
import { resumes } from './resumes.schema';
import { companies } from './companies.schema';
import { categories } from './categories.schema';
import { sources } from './sources.schema';
import { crawlRuns } from './crawl-runs.schema';
import { jobs } from './jobs.schema';

export const usersRelations = relations(users, ({ many, one }) => ({
  accounts: many(accounts),
  profile: one(seekerProfiles, { fields: [users.id], references: [seekerProfiles.userId] }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const seekerProfilesRelations = relations(seekerProfiles, ({ one, many }) => ({
  user: one(users, { fields: [seekerProfiles.userId], references: [users.id] }),
  experiences: many(experiences),
  educations: many(educations),
  resumes: many(resumes),
  profileSkills: many(profileSkills),
}));

export const experiencesRelations = relations(experiences, ({ one }) => ({
  profile: one(seekerProfiles, { fields: [experiences.profileId], references: [seekerProfiles.id] }),
}));

export const educationsRelations = relations(educations, ({ one }) => ({
  profile: one(seekerProfiles, { fields: [educations.profileId], references: [seekerProfiles.id] }),
}));

export const resumesRelations = relations(resumes, ({ one }) => ({
  profile: one(seekerProfiles, { fields: [resumes.profileId], references: [seekerProfiles.id] }),
}));

export const skillsRelations = relations(skills, ({ many }) => ({
  profileSkills: many(profileSkills),
}));

export const profileSkillsRelations = relations(profileSkills, ({ one }) => ({
  profile: one(seekerProfiles, { fields: [profileSkills.profileId], references: [seekerProfiles.id] }),
  skill: one(skills, { fields: [profileSkills.skillId], references: [skills.id] }),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  jobs: many(jobs),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, { fields: [categories.parentId], references: [categories.id], relationName: 'parent' }),
  children: many(categories, { relationName: 'parent' }),
  jobs: many(jobs),
}));

export const sourcesRelations = relations(sources, ({ many }) => ({
  jobs: many(jobs),
  crawlRuns: many(crawlRuns),
}));

export const crawlRunsRelations = relations(crawlRuns, ({ one }) => ({
  source: one(sources, { fields: [crawlRuns.sourceId], references: [sources.id] }),
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  source: one(sources, { fields: [jobs.sourceId], references: [sources.id] }),
  companyEntity: one(companies, { fields: [jobs.companyId], references: [companies.id] }),
  category: one(categories, { fields: [jobs.categoryId], references: [categories.id] }),
}));
