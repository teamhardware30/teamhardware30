import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ENRICH_JOB_QUEUE } from './crawler.constants';
import { EnrichJobData } from './dedupe.processor';

/**
 * Placeholder for the enrichment pipeline (embeddings, skill extraction,
 * salary normalization). It intentionally completes so the crawl chain stays
 * healthy until enrichment is implemented.
 */
@Processor(ENRICH_JOB_QUEUE)
export class EnrichJobProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichJobProcessor.name);

  async process(job: Job<EnrichJobData>): Promise<void> {
    this.logger.debug(`Enrichment queued for job ${job.data.jobId} (not implemented yet)`);
  }
}
