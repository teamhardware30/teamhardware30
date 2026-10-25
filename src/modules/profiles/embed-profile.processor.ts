import { createHash } from 'crypto';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiService } from '../ai/ai.service';
import { EMBED_PROFILE_QUEUE } from './profiles.constants';
import { ProfilesService } from './profiles.service';


export { EMBED_PROFILE_QUEUE };

export interface ProfileEmbeddingSource {
  headline: string | null;
  desiredTitles: string[];
  embedding: number[] | null;
  embeddingTextHash: string | null;
  embeddingModel: string | null;
  experiences: Array<{ title: string; company: string; description: string | null }>;
  profileSkills: Array<{ skill: { name: string } }>;
}

export function buildProfileEmbeddingText(profile: ProfileEmbeddingSource): string {
  const roles = (profile.experiences ?? [])
    .slice(0, 3)
    .map((experience) => `Role: ${experience.title} at ${experience.company}.${experience.description ? ` ${experience.description}` : ''}`);
  return [
    `Headline: ${profile.headline ?? ''}`,
    `Desired titles: ${(profile.desiredTitles ?? []).join(', ')}`,
    `Top skills: ${(profile.profileSkills ?? []).map((item) => item.skill.name).join(', ')}`,
    ...roles,
  ]
    .filter(Boolean)
    .join('\n');
}

export function hashProfileEmbeddingText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

@Processor(EMBED_PROFILE_QUEUE, { concurrency: 1 })
export class EmbedProfileProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedProfileProcessor.name);

  constructor(private readonly aiService: AiService, private readonly profilesService: ProfilesService) {
    super();
  }

  async process(job: Job<{ profileId: string }>): Promise<void> {
    const profile = await this.profilesService.findFullProfileById(job.data.profileId);
    if (!profile) throw new Error('Profile not found');

    const text = buildProfileEmbeddingText(profile as ProfileEmbeddingSource);
    const hash = hashProfileEmbeddingText(text);
    if (profile.embedding && profile.embeddingTextHash === hash && profile.embeddingModel === this.aiService.embeddingModel) {
      return;
    }

    const [vector] = await this.aiService.embed([text]);
    await this.profilesService.saveProfileEmbedding(profile.id ?? job.data.profileId, vector, hash, this.aiService.embeddingModel);
  }
}
