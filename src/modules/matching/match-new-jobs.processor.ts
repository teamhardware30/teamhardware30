import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MatchingService } from './matching.service';

export const MATCH_NEW_JOBS_QUEUE = 'match-new-jobs';

@Processor(MATCH_NEW_JOBS_QUEUE, { concurrency: 1 })
export class MatchNewJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchNewJobsProcessor.name);

  constructor(private readonly matchingService: MatchingService) {
    super();
  }

  async process(job: Job<{ jobIds: string[]; profileIds: string[] }>): Promise<void> {
    for (const profileId of job.data.profileIds) {
      await this.matchingService.computeForProfile(profileId, job.data.jobIds);
    }
  }
}
