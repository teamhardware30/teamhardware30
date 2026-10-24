import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import {
  seekerProfiles,
  experiences,
  educations,
  skills,
  profileSkills,
  resumes,
  SeekerProfile,
  NewExperience,
  NewEducation,
  NewResume,
} from '../../db/schema';
import { PreferencesDto } from './schemas/profile.schemas';

@Injectable()
export class ProfilesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async getOrCreateForUser(userId: string): Promise<SeekerProfile> {
    const existing = await this.db.query.seekerProfiles.findFirst({ where: eq(seekerProfiles.userId, userId) });
    if (existing) {
      return existing;
    }
    const [created] = await this.db.insert(seekerProfiles).values({ userId }).returning();
    return created;
  }

  findFullProfile(userId: string) {
    return this.db.query.seekerProfiles.findFirst({
      where: eq(seekerProfiles.userId, userId),
      with: {
        experiences: { orderBy: (table, { asc }) => [asc(table.sortOrder)] },
        educations: { orderBy: (table, { asc }) => [asc(table.sortOrder)] },
        resumes: { orderBy: (table, { desc: descend }) => [descend(table.createdAt)] },
        profileSkills: { with: { skill: true } },
      },
    });
  }

  async updateProfile(profileId: string, data: Partial<SeekerProfile>): Promise<SeekerProfile> {
    const [updated] = await this.db
      .update(seekerProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(seekerProfiles.id, profileId))
      .returning();
    return updated;
  }

  updatePreferences(profileId: string, prefs: PreferencesDto): Promise<SeekerProfile> {
    return this.updateProfile(profileId, {
      desiredTitles: prefs.desiredTitles,
      locations: prefs.locations,
      remote: prefs.remote ?? false,
      salaryMin: prefs.salaryMin ?? null,
      salaryMax: prefs.salaryMax ?? null,
      salaryCurrency: prefs.salaryCurrency,
      jobTypes: prefs.jobTypes,
    });
  }

  setParseStatus(profileId: string, status: SeekerProfile['parseStatus']) {
    return this.updateProfile(profileId, { parseStatus: status });
  }

  listExperiences(profileId: string) {
    return this.db.query.experiences.findMany({
      where: eq(experiences.profileId, profileId),
      orderBy: (table, { asc }) => [asc(table.sortOrder)],
    });
  }

  async addExperience(profileId: string, data: Omit<NewExperience, 'profileId'>) {
    const [row] = await this.db.insert(experiences).values({ ...data, profileId }).returning();
    return row;
  }

  removeExperience(profileId: string, id: string) {
    return this.db.delete(experiences).where(and(eq(experiences.id, id), eq(experiences.profileId, profileId)));
  }

  listEducations(profileId: string) {
    return this.db.query.educations.findMany({
      where: eq(educations.profileId, profileId),
      orderBy: (table, { asc }) => [asc(table.sortOrder)],
    });
  }

  async addEducation(profileId: string, data: Omit<NewEducation, 'profileId'>) {
    const [row] = await this.db.insert(educations).values({ ...data, profileId }).returning();
    return row;
  }

  removeEducation(profileId: string, id: string) {
    return this.db.delete(educations).where(and(eq(educations.id, id), eq(educations.profileId, profileId)));
  }

  suggestSkills(query: string, limit = 10) {
    if (!query.trim()) {
      return [];
    }
    return this.db.query.skills.findMany({
      where: or(ilike(skills.name, `%${query}%`)),
      limit,
    });
  }

  listProfileSkills(profileId: string) {
    return this.db.query.profileSkills.findMany({
      where: eq(profileSkills.profileId, profileId),
      with: { skill: true },
    });
  }

  async addSkill(profileId: string, name: string) {
    const trimmed = name.trim();
    let skill = await this.db.query.skills.findFirst({ where: ilike(skills.name, trimmed) });
    if (!skill) {
      [skill] = await this.db.insert(skills).values({ name: trimmed }).returning();
    }
    await this.db
      .insert(profileSkills)
      .values({ profileId, skillId: skill.id })
      .onConflictDoNothing();
    return this.listProfileSkills(profileId);
  }

  async removeSkill(profileId: string, skillId: string) {
    await this.db
      .delete(profileSkills)
      .where(and(eq(profileSkills.profileId, profileId), eq(profileSkills.skillId, skillId)));
    return this.listProfileSkills(profileId);
  }

  listResumes(profileId: string) {
    return this.db.query.resumes.findMany({
      where: eq(resumes.profileId, profileId),
      orderBy: [desc(resumes.createdAt)],
    });
  }

  async addResume(profileId: string, data: Omit<NewResume, 'profileId'>) {
    const existingCount = (await this.listResumes(profileId)).length;
    const [row] = await this.db
      .insert(resumes)
      .values({ ...data, profileId, isPrimary: existingCount === 0 })
      .returning();
    return row;
  }

  async setPrimaryResume(profileId: string, resumeId: string) {
    await this.db.update(resumes).set({ isPrimary: false }).where(eq(resumes.profileId, profileId));
    await this.db
      .update(resumes)
      .set({ isPrimary: true })
      .where(and(eq(resumes.id, resumeId), eq(resumes.profileId, profileId)));
    return this.listResumes(profileId);
  }

  async removeResume(profileId: string, resumeId: string) {
    await this.db.delete(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.profileId, profileId)));
    return this.listResumes(profileId);
  }
}
