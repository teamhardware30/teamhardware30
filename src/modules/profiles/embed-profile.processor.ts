import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AiService } from '../ai/ai.service';
import { ProfilesService } from './profiles.service';

export const EMBED_PROFILE_QUEUE = 'embed-profile';

export interface EmbedProfileJobData {
  profileId: string;
}

@Processor(EMBED_PROFILE_QUEUE)
export class EmbedProfileProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedProfileProcessor.name);

  constructor(
    private readonly aiService: AiService,
    private readonly profilesService: ProfilesService,
  ) {
    super();
  }

  async process(job: Job<EmbedProfileJobData>): Promise<void> {
    const full = await this.profilesService.findFullProfile(job.data.profileId);
    if (!full) {
      return;
    }

    const parts = [
      full.headline,
      full.summary,
      ...full.experiences.map((exp) => `${exp.title} at ${exp.company}. ${exp.description ?? ''}`),
      ...full.educations.map((edu) => `${edu.degree ?? ''} ${edu.fieldOfStudy ?? ''} at ${edu.school}`),
      full.profileSkills.map((ps) => ps.skill.name).join(', '),
    ].filter((part): part is string => Boolean(part && part.trim()));

    if (parts.length === 0) {
      return;
    }

    try {
      const [embedding] = await this.aiService.embed([parts.join('\n')]);
      if (embedding?.length) {
        await this.profilesService.updateProfile(job.data.profileId, { embedding });
      }
    } catch (error) {
      this.logger.warn(`Failed to embed profile ${job.data.profileId}: ${String(error)}`);
    }
  }
}
