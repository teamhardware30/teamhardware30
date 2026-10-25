import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MatchingService } from './matching.service';

export const COMPUTE_MATCHES_QUEUE = 'compute-matches';

@Processor(COMPUTE_MATCHES_QUEUE, { concurrency: 1 })
export class ComputeMatchesProcessor extends WorkerHost {
  private readonly logger = new Logger(ComputeMatchesProcessor.name);

  constructor(private readonly matchingService: MatchingService) {
    super();
  }

  async process(job: Job<{ profileId: string }>): Promise<void> {
    await this.matchingService.computeForProfile(job.data.profileId);
  }
}
