import { createHash } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parsedResumeSchema} from '../../common/schemas/parsed-resume.schema';
import { Database, DatabaseTransaction } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import {
  SeekerProfile,
  Experience,
  Education,
  Skill,
  Resume,
  ProfileSkill,
  NewResume} from '../../db/schema';
import {
  seekerProfiles,
  experiences,
  educations,
  skills,
  profileSkills,
  resumes
} from '../../db/schema';
import { EMBED_PROFILE_QUEUE } from './profiles.constants';
import { ExperienceDto, EducationDto, PreferencesDto, ProfileDetailsDto } from './schemas/profile.schemas';

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @InjectQueue(EMBED_PROFILE_QUEUE) private readonly embedProfileQueue?: Queue,
    @InjectQueue('compute-matches') private readonly computeMatchesQueue?: Queue,
  ) {}

  async getOrCreateForUser(userId: string): Promise<SeekerProfile> {
    const existing = await this.db.query.seekerProfiles.findFirst({ where: eq(seekerProfiles.userId, userId) });
    if (existing) return existing;
    const [profile] = await this.db.insert(seekerProfiles).values({ userId }).returning();
    return profile;
  }

  async findFullProfile(profileId: string): Promise<SeekerProfile & { experiences: Experience[]; educations: Education[]; profileSkills: (ProfileSkill & { skill: Skill })[]; resumes: Resume[] } | undefined> {
    if (!this.db.query?.seekerProfiles?.findFirst) return undefined;
    return this.db.query.seekerProfiles.findFirst({
      where: eq(seekerProfiles.id, profileId),
      with: {
        experiences: { orderBy: (table, { asc }) => [asc(table.sortOrder), asc(table.createdAt)] },
        educations: { orderBy: (table, { asc }) => [asc(table.sortOrder), asc(table.createdAt)] },
        profileSkills: { with: { skill: true } },
        resumes: true,
      },
    }) as Promise<SeekerProfile & { experiences: Experience[]; educations: Education[]; profileSkills: (ProfileSkill & { skill: Skill })[]; resumes: Resume[] } | undefined>;
  }

  async findResumeById(resumeId: string): Promise<Resume | undefined> {
    return this.db.query.resumes.findFirst({ where: eq(resumes.id, resumeId) });
  }

  async findFullProfileById(profileId: string): Promise<SeekerProfile & { experiences: Experience[]; educations: Education[]; profileSkills: (ProfileSkill & { skill: Skill })[]; resumes: Resume[] } | undefined> {
    return this.findFullProfile(profileId);
  }

  async saveResumeRawText(profileId: string, resumeId: string, rawText: string): Promise<void> {
    await this.db.update(resumes).set({ rawText, updatedAt: new Date() }).where(eq(resumes.id, resumeId));
  }

  async updateProfile(profileId: string, data: Partial<{ headline: string | null; summary: string | null }>): Promise<SeekerProfile> {
    const [profile] = await this.db.update(seekerProfiles).set({ ...data, updatedAt: new Date() }).where(eq(seekerProfiles.id, profileId)).returning();
    await this.scheduleProfileEmbedding(profileId);
    await this.scheduleComputeMatches(profileId);
    return profile;
  }

  async updateDetails(profileId: string, data: ProfileDetailsDto): Promise<void> {
    await this.db
      .update(seekerProfiles)
      .set({
        headline: data.headline === '' ? null : data.headline,
        summary: data.summary === '' ? null : data.summary,
        location: data.location === '' ? null : data.location,
        yearsExperience: data.yearsExperience,
        seniority: data.seniority === '' ? null : data.seniority,
        openToRelocate: data.openToRelocate ?? false,
        updatedAt: new Date(),
      })
      .where(eq(seekerProfiles.id, profileId));
    await this.scheduleEmbedding(profileId);
    await this.scheduleComputeMatches(profileId);
  }

  async updatePreferences(profileId: string, data: PreferencesDto): Promise<void> {
    await this.db
      .update(seekerProfiles)
      .set({
        desiredTitles: data.desiredTitles,
        locations: data.locations,
        remote: data.remote,
        remotePref: data.remote,
        salaryMin: data.salaryMin ?? null,
        salaryMax: data.salaryMax ?? null,
        salaryCurrency: data.salaryCurrency,
        jobTypes: data.jobTypes,
        updatedAt: new Date(),
      })
      .where(eq(seekerProfiles.id, profileId));
    await this.scheduleEmbedding(profileId);
    await this.scheduleComputeMatches(profileId);
  }

  async addExperience(profileId: string, data: ExperienceDto): Promise<void> {
    await this.db.insert(experiences).values({
      profileId,
      company: data.company,
      title: data.title,
      location: data.location || null,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      current: data.current,
      description: data.description || null,
      bullets: (data.description || '').split('\n').map((item) => item.trim()).filter(Boolean),
    });
  }

  async updateExperience(profileId: string, experienceId: string, data: ExperienceDto): Promise<void> {
    const result = await this.db
      .update(experiences)
      .set({
        company: data.company,
        title: data.title,
        location: data.location || null,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        current: data.current,
        description: data.description || null,
        bullets: (data.description || '').split('\n').map((item) => item.trim()).filter(Boolean),
        updatedAt: new Date(),
      })
      .where(and(eq(experiences.id, experienceId), eq(experiences.profileId, profileId)))
      .returning({ id: experiences.id });
    if (result.length === 0) throw new Error('Experience not found');
  }

  async removeExperience(profileId: string, experienceId: string): Promise<void> {
    await this.db.delete(experiences).where(and(eq(experiences.id, experienceId), eq(experiences.profileId, profileId)));
  }

  async reorderExperience(profileId: string, experienceId: string, direction: -1 | 1): Promise<void> {
    await this.reorderRows(experiences, profileId, experienceId, direction);
  }

  async addEducation(profileId: string, data: EducationDto): Promise<void> {
    await this.db.insert(educations).values({
      profileId,
      school: data.school,
      degree: data.degree || null,
      fieldOfStudy: data.fieldOfStudy || null,
      startDate: data.startDate || null,
      endDate: data.endDate || null,
      description: data.description || null,
    });
  }

  async updateEducation(profileId: string, educationId: string, data: EducationDto): Promise<void> {
    const result = await this.db
      .update(educations)
      .set({
        school: data.school,
        degree: data.degree || null,
        fieldOfStudy: data.fieldOfStudy || null,
        startDate: data.startDate || null,
        endDate: data.endDate || null,
        description: data.description || null,
        updatedAt: new Date(),
      })
      .where(and(eq(educations.id, educationId), eq(educations.profileId, profileId)))
      .returning({ id: educations.id });
    if (result.length === 0) throw new Error('Education not found');
  }

  async removeEducation(profileId: string, educationId: string): Promise<void> {
    await this.db.delete(educations).where(and(eq(educations.id, educationId), eq(educations.profileId, profileId)));
  }

  async reorderEducation(profileId: string, educationId: string, direction: -1 | 1): Promise<void> {
    await this.reorderRows(educations, profileId, educationId, direction);
  }

  async listExperiences(profileId: string): Promise<Experience[]> {
    return this.db.query.experiences.findMany({
      where: eq(experiences.profileId, profileId),
      orderBy: (table, { asc }) => [asc(table.sortOrder), asc(table.createdAt)],
    });
  }

  async listEducations(profileId: string): Promise<Education[]> {
    return this.db.query.educations.findMany({
      where: eq(educations.profileId, profileId),
      orderBy: (table, { asc }) => [asc(table.sortOrder), asc(table.createdAt)],
    });
  }

  async listProfileSkills(profileId: string): Promise<(ProfileSkill & { skill: Skill })[]> {
    return this.db.query.profileSkills.findMany({
      where: eq(profileSkills.profileId, profileId),
      with: { skill: true },
    }) as Promise<(ProfileSkill & { skill: Skill })[]>;
  }

  async addSkill(profileId: string, name: string): Promise<(ProfileSkill & { skill: Skill })[]> {
    const skill = await this.findOrCreateCanonicalSkill(name);
    try {
      await this.db.insert(profileSkills).values({ profileId, skillId: skill.id });
    } catch {
      // Duplicate skill rows are expected when the same skill is added twice.
    }
    await this.scheduleEmbedding(profileId);
    await this.scheduleComputeMatches(profileId);
    return this.listProfileSkills(profileId);
  }

  async removeSkill(profileId: string, skillId: string): Promise<(ProfileSkill & { skill: Skill })[]> {
    await this.db.delete(profileSkills).where(and(eq(profileSkills.profileId, profileId), eq(profileSkills.skillId, skillId)));
    await this.scheduleEmbedding(profileId);
    await this.scheduleComputeMatches(profileId);
    return this.listProfileSkills(profileId);
  }

  async findOrCreateCanonicalSkill(name: string): Promise<Skill> {
    const normalized = name.trim();
    const existing = await this.db.query.skills.findFirst({
      where: sql`lower(${skills.name}) = lower(${normalized}) OR exists (select 1 from unnest(${skills.aliases}) as alias where lower(alias) = lower(${normalized}))`,
    });
    if (existing) return existing;
    const [skill] = await this.db
      .insert(skills)
      .values({ name: normalized, needsReview: true })
      .returning();
    return skill;
  }

  async suggestSkills(query: string): Promise<Skill[]> {
    const term = query.trim();
    if (!term) return [];
    return this.db.query.skills.findMany({
      where: ilike(skills.name, `%${term}%`),
      limit: 10,
    });
  }

  async listResumes(profileId: string): Promise<Resume[]> {
    return this.db.query.resumes.findMany({ where: eq(resumes.profileId, profileId), orderBy: (table, { asc }) => [asc(table.createdAt)] });
  }

  async addResume(profileId: string, data: Partial<NewResume>): Promise<Resume> {
    const existing = await this.listResumes(profileId);
    const isPrimary = existing.length === 0 || data.isPrimary === true;
    if (isPrimary) {
      await this.db.update(resumes).set({ isPrimary: false }).where(eq(resumes.profileId, profileId));
    }
    const [resume] = await this.db
      .insert(resumes)
      .values({ ...data, profileId, isPrimary } as NewResume)
      .returning();
    return resume;
  }

  async setPrimaryResume(profileId: string, resumeId: string): Promise<Resume[]> {
    const [resume] = await this.db
      .select()
      .from(resumes)
      .where(and(eq(resumes.id, resumeId), eq(resumes.profileId, profileId)));
    if (!resume) throw new Error('Resume not found');
    await this.db.update(resumes).set({ isPrimary: false }).where(eq(resumes.profileId, profileId));
    await this.db.update(resumes).set({ isPrimary: true }).where(eq(resumes.id, resumeId));
    return this.listResumes(profileId);
  }

  async removeResume(profileId: string, resumeId: string): Promise<Resume[]> {
    const [resume] = await this.db.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.profileId, profileId)));
    if (!resume) throw new Error('Resume not found');
    await this.db.delete(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.profileId, profileId)));
    if (resume.isPrimary) {
      const [next] = await this.db.select().from(resumes).where(eq(resumes.profileId, profileId)).orderBy(resumes.createdAt).limit(1);
      if (next) await this.db.update(resumes).set({ isPrimary: true }).where(eq(resumes.id, next.id));
    }
    return this.listResumes(profileId);
  }

  async renameResume(profileId: string, resumeId: string, fileName: string): Promise<Resume[]> {
    const result = await this.db
      .update(resumes)
      .set({ fileName, updatedAt: new Date() })
      .where(and(eq(resumes.id, resumeId), eq(resumes.profileId, profileId)))
      .returning({ id: resumes.id });
    if (result.length === 0) throw new Error('Resume not found');
    return this.listResumes(profileId);
  }

  async updateResumeParseResult(resumeId: string, data: { rawText?: string | null; parsedJson?: Record<string, unknown> | null; parseStatus?: string | null; parseError?: string | null }): Promise<void> {
    await this.db
      .update(resumes)
      .set({
        rawText: data.rawText ?? undefined,
        parsedJson: data.parsedJson ?? undefined,
        parseStatus: data.parseStatus ?? undefined,
        parseError: data.parseError ?? undefined,
        updatedAt: new Date(),
      })
      .where(eq(resumes.id, resumeId));
  }

  async saveProfileEmbedding(profileId: string, embedding: number[], textHash: string, model: string): Promise<void> {
    await this.updateEmbedding(profileId, embedding, model, textHash);
  }

  async updateEmbedding(profileId: string, embedding: number[], model: string, textHash: string): Promise<void> {
    await this.db
      .update(seekerProfiles)
      .set({ embedding, embeddingModel: model, embeddingTextHash: textHash, updatedAt: new Date() })
      .where(eq(seekerProfiles.id, profileId));
  }

  async setParseStatus(profileId: string, status: 'pending' | 'processing' | 'done' | 'failed', error?: string): Promise<void> {
    await this.db
      .update(seekerProfiles)
      .set({ parseStatus: status, parseError: error ?? null, updatedAt: new Date() })
      .where(eq(seekerProfiles.id, profileId));
  }

  async applyParsedResume(profileId: string, parsed: z.infer<typeof parsedResumeSchema>, resumeId: string): Promise<void> {
    await this.db.transaction(async (tx: DatabaseTransaction) => {
      await tx
        .update(seekerProfiles)
        .set({
          headline: parsed.headline,
          summary: parsed.summary,
          location: parsed.contact.location,
          seniority: parsed.seniority,
          yearsExperience: parsed.total_years_experience ?? undefined,
          parseStatus: 'done',
          parseError: null,
          updatedAt: new Date(),
        })
        .where(eq(seekerProfiles.id, profileId));

      await tx.delete(experiences).where(eq(experiences.profileId, profileId));
      await tx.delete(educations).where(eq(educations.profileId, profileId));
      await tx.delete(profileSkills).where(eq(profileSkills.profileId, profileId));

      if (parsed.experiences.length > 0) {
        await tx.insert(experiences).values(
          parsed.experiences.map((experience, index) => ({
            profileId,
            title: experience.title,
            company: experience.company,
            location: experience.location,
            startDate: toDate(experience.start),
            endDate: experience.end === 'present' ? null : toDate(experience.end),
            current: experience.end === 'present',
            description: experience.bullets.join('\n') || null,
            bullets: experience.bullets,
            sortOrder: index,
          })),
        );
      }

      if (parsed.education.length > 0) {
        await tx.insert(educations).values(
          parsed.education.map((education, index) => ({
            profileId,
            school: education.school,
            degree: education.degree,
            fieldOfStudy: education.field,
            startDate: toDate(education.start),
            endDate: toDate(education.end),
            sortOrder: index,
          })),
        );
      }

      const profileSkillValues: { profileId: string; skillId: string }[] = [];
      const seenSkillIds = new Set<string>();
      for (const skill of parsed.skills) {
        const canonical = await this.findOrCreateCanonicalSkillTx(tx, skill.name, skill.kind);
        if (seenSkillIds.has(canonical.id)) continue;
        seenSkillIds.add(canonical.id);
        profileSkillValues.push({ profileId, skillId: canonical.id });
      }
      if (profileSkillValues.length > 0) {
        await tx.insert(profileSkills).values(profileSkillValues);
      }

      await tx.update(resumes).set({ parsedJson: parsed }).where(eq(resumes.id, resumeId));
    });
  }

  private async findOrCreateCanonicalSkillTx(tx: DatabaseTransaction, name: string, kind: string): Promise<Skill> {
    const query = (tx as unknown as { query?: { skills?: { findMany?: (input: { where: unknown }) => Promise<Skill[]> } } }).query?.skills?.findMany;
    const candidates = query
      ? await query({ where: sql`lower(${skills.name}) = lower(${name}) OR exists (select 1 from unnest(${skills.aliases}) as alias where lower(alias) = lower(${name}))` })
      : [];
    const existing = candidates.find(
      (skill) => skill.name.toLowerCase() === name.trim().toLowerCase() || skill.aliases.some((alias) => alias.toLowerCase() === name.trim().toLowerCase()),
    );
    if (existing) return existing;
    const [skill] = await tx.insert(skills).values({ name: name.trim(), category: kind, needsReview: true }).returning();
    return skill;
  }

  async setOnboardingStep(profileId: string, step: number): Promise<void> {
    await this.db.update(seekerProfiles).set({ onboardingStep: step, updatedAt: new Date() }).where(eq(seekerProfiles.id, profileId));
  }

  async markOnboardingComplete(profileId: string): Promise<void> {
    await this.db
      .update(seekerProfiles)
      .set({ onboardingStep: 5, onboardingCompletedAt: new Date(), updatedAt: new Date() })
      .where(eq(seekerProfiles.id, profileId));
  }

  async markMatchesViewed(profileId: string): Promise<void> {
    await this.db.update(seekerProfiles).set({ lastMatchesViewedAt: new Date(), updatedAt: new Date() }).where(eq(seekerProfiles.id, profileId));
  }

  isOnboardingComplete(profile: SeekerProfile): boolean {
    return profile.onboardingCompletedAt !== null || profile.onboardingStep >= 5;
  }

  profileCompleteness(profile: SeekerProfile & { experiences?: Experience[]; educations?: Education[]; profileSkills?: unknown[]; resumes?: Resume[] }): number {
    const checks = [
      Boolean(profile.headline),
      Boolean(profile.summary),
      Boolean(profile.location),
      profile.desiredTitles.length > 0,
      profile.experiences && profile.experiences.length > 0,
      profile.educations && profile.educations.length > 0,
      profile.profileSkills && profile.profileSkills.length > 0,
      profile.resumes && profile.resumes.some((resume) => resume.isPrimary),
      profile.parseStatus === 'done',
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }

  async scheduleProfileEmbedding(profileId: string): Promise<boolean> {
    if (!this.embedProfileQueue) return false;
    const dbQuery = this.db.query as { seekerProfiles?: { findFirst?: (input: unknown) => unknown } } | undefined;
    const profile = dbQuery?.seekerProfiles?.findFirst ? await this.findFullProfile(profileId) : undefined;
    if (profile) {
      const text = this.embeddingText(profile);
      const hash = createHash('sha256').update(text).digest('hex');
      if (profile.embedding && profile.embeddingTextHash === hash) return false;
    }
    try {
      await this.embedProfileQueue.add('embed', { profileId }, profileEmbeddingJobOptions(profileId));
      return true;
    } catch {
      return false;
    }
  }

  async scheduleComputeMatches(profileId: string): Promise<void> {
    if (!this.computeMatchesQueue) return;
    try {
      await this.computeMatchesQueue.add('compute-matches', { profileId }, { jobId: `profile-${profileId}`, delay: 60_000, removeOnComplete: true, removeOnFail: false });
    } catch (error) {
      console.error('Could not schedule match computation', error);
    }
  }

  async scheduleEmbedding(profileId: string): Promise<void> {
    await this.scheduleProfileEmbedding(profileId);
  }

  embeddingText(profile: SeekerProfile & { experiences?: Experience[]; profileSkills?: (ProfileSkill & { skill: Skill })[] }): string {
    const experiences = (profile.experiences ?? []).slice(0, 3).map((experience) => `${experience.title} at ${experience.company}`);
    const skills = (profile.profileSkills ?? []).slice(0, 10).map((item) => item.skill.name);
    return [profile.headline ?? '', profile.desiredTitles.join(', '), skills.join(', '), experiences.join('; ')].filter(Boolean).join('\n');
  }

  private async reorderRows(table: typeof experiences | typeof educations, profileId: string, rowId: string, direction: -1 | 1): Promise<void> {
    const query = table === experiences ? this.db.query.experiences : this.db.query.educations;
    const rows = await query.findMany({
      where: eq(table.profileId, profileId),
      orderBy: (row, { asc }) => [asc(row.sortOrder), asc(row.createdAt)],
    });
    const index = rows.findIndex((row) => row.id === rowId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return;
    [rows[index], rows[nextIndex]] = [rows[nextIndex], rows[index]];
    await this.db.transaction(async (tx: DatabaseTransaction) => {
      for (const [position, row] of rows.entries()) {
        await tx.update(table).set({ sortOrder: position, updatedAt: new Date() }).where(eq(table.id, row.id));
      }
    });
  }
}

export function findCanonicalSkill(name: string, skills: Skill[]): Skill | undefined {
  const normalized = name.trim().toLowerCase();
  return skills.find(
    (skill) => skill.name.toLowerCase() === normalized || skill.aliases.some((alias) => alias.toLowerCase() === normalized),
  );
}

export function profileEmbeddingJobOptions(profileId: string): {
  jobId: string;
  delay: number;
  attempts: number;
  removeOnComplete: boolean;
} {
  return {
    jobId: `embed-profile-${profileId}`,
    delay: 60_000,
    attempts: 4,
    removeOnComplete: true,
  };
}

function toDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}$/.test(value)) return `${value}-01-01`;
  return value;
}

