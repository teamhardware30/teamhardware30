import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, count, cosineDistance, eq, gte, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { jobs, matches, seekerProfiles, applications } from '../../db/schema';
import type { Job } from '../../db/schema';
import { AiService } from '../ai/ai.service';
import { ProfilesService } from '../profiles/profiles.service';
import { totalScore } from './scoring';

export interface MatchExplanation {
  why_it_fits: string[];
  gaps: string[];
  verdict: 'strong' | 'good' | 'stretch';
  contentHash?: string;
}

@Injectable()
export class MatchingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly profilesService: ProfilesService,
    private readonly aiService: AiService,
    @InjectQueue('compute-matches') private readonly computeQueue?: Queue,
    @InjectQueue('match-new-jobs') private readonly matchNewJobsQueue?: Queue,
  ) {}

  async computeForProfile(profileId: string, _jobIds?: string[]): Promise<void> {
    const profile = await this.profilesService.findFullProfile(profileId);
    if (!profile || !profile.embedding) return;

    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const hidden = await this.db.select({ jobId: matches.jobId }).from(matches).where(and(eq(matches.profileId, profileId), eq(matches.status, 'hidden')));
    const applied = await this.db.select({ jobId: applications.jobId }).from(applications).where(eq(applications.profileId, profileId));
    const excluded = [...hidden.map((row) => row.jobId), ...applied.map((row) => row.jobId)];

    const conditions = [eq(jobs.isActive, true), or(isNull(jobs.expiresAt), gte(jobs.expiresAt, new Date())) as SQL, isNotNull(jobs.embedding)];
    conditions.push(sql`coalesce(${jobs.postedAt}, ${jobs.createdAt}) >= ${cutoff}`);
    if (excluded.length > 0) conditions.push(sql`${jobs.id} not in (${sql.join(excluded.map((id) => sql`${id}::uuid`), sql`, `)})`);

    const candidates = await this.db
      .select({ job: jobs, distance: cosineDistance(jobs.embedding, profile.embedding) })
      .from(jobs)
      .where(and(...conditions))
      .orderBy(cosineDistance(jobs.embedding, profile.embedding))
      .limit(300);

    const scored = candidates
      .map((candidate) => {
        const job = candidate.job;
        const score = totalScore({
          semantic: 1 - Number(candidate.distance ?? 1),
          skills: { profile: profile.profileSkills.map((item) => item.skill.name), required: job.requiredSkills ?? [], preferred: job.preferredSkills ?? [] },
          title: { desired: profile.desiredTitles, job: job.title },
          location: { profile: { locations: profile.locations, remote: profile.remote, openToRelocate: profile.openToRelocate }, job: { location: job.location, city: job.city, country: job.country, remote: job.remote, remoteType: job.remoteType } },
          seniority: { profile: profile.seniority, job: job.seniority },
          salary: { profileMin: profile.salaryMin, profileMax: profile.salaryMax, jobMin: job.salaryMin, jobMax: job.salaryMax, profileCurrency: profile.salaryCurrency ?? undefined, jobCurrency: job.salaryCurrency ?? undefined },
        });
        return { job, score };
      })
      .sort((left, right) => right.score.total - left.score.total)
      .slice(0, 100);

    const topIds = scored.map((item) => item.job.id);
    const existing = await this.db.select().from(matches).where(eq(matches.profileId, profileId));
    const existingMap = new Map(existing.map((row) => [row.jobId, row]));

    await this.db.transaction(async (tx) => {
      for (const item of scored) {
        const previous = existingMap.get(item.job.id);
        const explanation = previous && previous.score === item.score.total ? previous.explanation : null;
        await tx
          .insert(matches)
          .values({
            profileId,
            jobId: item.job.id,
            score: item.score.total,
            breakdown: item.score.breakdown as unknown as Record<string, number>,
            explanation,
            status: previous?.status ?? 'new',
            computedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [matches.profileId, matches.jobId],
            set: {
              score: item.score.total,
              breakdown: item.score.breakdown as unknown as Record<string, number>,
              computedAt: new Date(),
              explanation,
            },
          });
      }

      if (topIds.length > 0) {
        await tx.delete(matches).where(and(eq(matches.profileId, profileId), or(lt(matches.score, 40), sql`${matches.jobId} not in (${sql.join(topIds.map((id) => sql`${id}::uuid`), sql`, `)})`)));
      } else {
        await tx.delete(matches).where(eq(matches.profileId, profileId));
      }
    });
  }

  async listMatches(profileId: string, filters: { status?: string; category?: string; remote?: boolean; minScore?: number } = {}): Promise<Array<typeof matches.$inferSelect & { job: Job }>> {
    const rows = await this.db.query.matches.findMany({
      where: eq(matches.profileId, profileId),
      with: { job: true },
      orderBy: (table, { desc }) => [desc(table.score), desc(table.computedAt)],
    });
    return rows.filter((row) => {
      if (filters.status && filters.status !== 'all' && row.status !== filters.status) return false;
      if (filters.minScore !== undefined && row.score < filters.minScore) return false;
      if (filters.remote && !row.job.remote) return false;
      if (filters.category && row.job.categoryId !== filters.category) return false;
      return true;
    }) as Array<typeof matches.$inferSelect & { job: Job }>;
  }

  async getMatch(profileId: string, matchId: string) {
    return this.db.query.matches.findFirst({ where: and(eq(matches.id, matchId), eq(matches.profileId, profileId)), with: { job: true } });
  }

  async setStatus(profileId: string, matchId: string, status: 'new' | 'saved' | 'hidden' | 'applied'): Promise<void> {
    await this.db.update(matches).set({ status, updatedAt: new Date() }).where(and(eq(matches.id, matchId), eq(matches.profileId, profileId)));
  }

  async getProfileIdForUser(userId: string): Promise<string> {
    const profile = await this.profilesService.getOrCreateForUser(userId);
    return profile.id;
  }

  async markMatchesViewed(profileId: string): Promise<void> {
    await this.profilesService.markMatchesViewed(profileId);
  }

  async countNewSince(profileId: string, since: Date | null): Promise<number> {
    const rows = await this.db.select({ value: count() }).from(matches).where(and(eq(matches.profileId, profileId), since ? gte(matches.computedAt, since) : sql`true`));
    return Number(rows[0]?.value ?? 0);
  }

  async scheduleCompute(profileId: string): Promise<void> {
    if (!this.computeQueue) return;
    await this.computeQueue.add('compute-matches', { profileId }, { jobId: `profile-${profileId}`, delay: 60_000, removeOnComplete: true, removeOnFail: false });
  }

  async scheduleMatchNewJobs(jobIds: string[]): Promise<void> {
    if (!this.matchNewJobsQueue || jobIds.length === 0) return;
    const profiles = await this.db.select({ id: seekerProfiles.id }).from(seekerProfiles).where(isNotNull(seekerProfiles.embedding));
    const chunks: string[][] = [];
    for (let index = 0; index < jobIds.length; index += 25) chunks.push(jobIds.slice(index, index + 25));
    for (const chunk of chunks) {
      await this.matchNewJobsQueue.add('match-new-jobs', { jobIds: chunk, profileIds: profiles.map((profile) => profile.id) }, { removeOnComplete: true, removeOnFail: false });
    }
  }

  async refreshAll(): Promise<void> {
    const profiles = await this.db.select({ id: seekerProfiles.id }).from(seekerProfiles).where(isNotNull(seekerProfiles.embedding));
    for (const profile of profiles) {
      await this.computeForProfile(profile.id);
    }
  }
}

