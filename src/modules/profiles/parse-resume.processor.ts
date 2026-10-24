import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ProfilesService } from './profiles.service';

export const PARSE_RESUME_QUEUE = 'parse-resume';

export interface ParseResumeJobData {
  profileId: string;
  resumeId: string;
}

@Processor(PARSE_RESUME_QUEUE)
export class ParseResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(ParseResumeProcessor.name);

  constructor(private readonly profilesService: ProfilesService) {
    super();
  }

  async process(job: Job<ParseResumeJobData>): Promise<void> {
    this.logger.log(`Parsing resume ${job.data.resumeId} for profile ${job.data.profileId}`);
    await this.profilesService.setParseStatus(job.data.profileId, 'done');
  }
}
