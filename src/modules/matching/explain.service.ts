import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DRIZZLE, Database } from '../../db/db.provider';
import { matches, seekerProfiles } from '../../db/schema';
import type { Job } from '../../db/schema';
import { AiService } from '../ai/ai.service';

const explanationSchema = z.object({
  why_it_fits: z.array(z.string().trim().max(120)).max(3),
  gaps: z.array(z.string().trim().max(120)).max(2),
  verdict: z.enum(['strong', 'good', 'stretch']),
});

@Injectable()
export class MatchExplanationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database, private readonly aiService: AiService) {}

  async explain(profileId: string, matchId: string): Promise<z.infer<typeof explanationSchema> | null> {
    const match = (await this.db.query.matches.findFirst({ where: and(eq(matches.id, matchId), eq(matches.profileId, profileId)), with: { job: true } })) as
      | (typeof matches.$inferSelect & { job: Job })
      | undefined;
    if (!match) return null;
    const profile = await this.db.query.seekerProfiles.findFirst({ where: eq(seekerProfiles.id, profileId) });
    const contentHash = createHash('sha256').update(`${profile?.headline ?? ''}|${match.job.title}|${match.score}`).digest('hex');

    const existing = match.explanation as { contentHash?: string } | null;
    if (existing?.contentHash === contentHash) return existing as z.infer<typeof explanationSchema>;

    try {
      const explanation = await this.aiService.completeJson('match_explain', {
        profile_summary: profile?.summary ?? profile?.headline ?? '',
        profile_skills: (profile as { profileSkills?: Array<{ skill: { name: string } }> } | undefined)?.profileSkills?.map((item) => item.skill.name).join(', ') ?? '',
        job_title: match.job.title,
        company: match.job.company,
        required_skills: (match.job.requiredSkills ?? []).join(', '),
        preferred_skills: (match.job.preferredSkills ?? []).join(', '),
        min_years: '',
        breakdown_json: JSON.stringify(match.breakdown),
      }, explanationSchema);
      const stored = { ...explanation, contentHash };
      await this.db.update(matches).set({ explanation: stored, updatedAt: new Date() }).where(eq(matches.id, match.id));
      return stored;
    } catch {
      const fallback = {
        why_it_fits: ['Your skills and experience align with several requirements for this role.'],
        gaps: ['Review the missing skills in the breakdown before applying.'],
        verdict: match.score >= 80 ? 'strong' : match.score >= 60 ? 'good' : 'stretch',
        contentHash,
      } as z.infer<typeof explanationSchema> & { contentHash: string };
      await this.db.update(matches).set({ explanation: fallback, updatedAt: new Date() }).where(eq(matches.id, match.id));
      return fallback;
    }
  }
}
