import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { jobs } from '../../db/schema';
import { CrawlerService } from './crawler.service';
import { DedupeService } from './dedupe.service';
import { DEDUPE_QUEUE, ENRICH_JOB_QUEUE } from './crawler.constants';

export interface DedupeJobData {
  runId: string;
  sourceId: string;
  jobIds: string[];
  isLastBatch: boolean;
  skipped: number;
}

export interface EnrichJobData {
  jobId: string;
}

@Processor(DEDUPE_QUEUE)
export class DedupeProcessor extends WorkerHost {
  private readonly logger = new Logger(DedupeProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crawlerService: CrawlerService,
    private readonly dedupeService: DedupeService,
    @InjectQueue(ENRICH_JOB_QUEUE) private readonly enrichQueue: Queue<EnrichJobData>,
  ) {
    super();
  }

  async process(job: Job<DedupeJobData>): Promise<void> {
    const { runId, sourceId, jobIds, isLastBatch, skipped } = job.data;
    let duplicates = 0;

    try {
      for (const jobId of jobIds) {
        const row = await this.crawlerService.findJobById(jobId);
        if (!row || !row.isActive) {
          continue;
        }

        const duplicateOf = await this.dedupeService.findDuplicate(row);
        if (duplicateOf) {
          await this.db.update(jobs).set({ isActive: false, updatedAt: new Date() }).where(eq(jobs.id, row.id));
          duplicates += 1;
          this.logger.log(`Deactivated duplicate job ${row.id} (duplicate of ${duplicateOf})`);
          continue;
        }

        await this.enrichQueue.add(
          'enrich',
          { jobId: row.id },
          { removeOnComplete: 1_000, removeOnFail: 5_000, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
        );
      }

      await this.crawlerService.incrementRun(runId, { skipped: skipped + duplicates });

      if (isLastBatch) {
        await this.crawlerService.finishRun(runId, 'success');
        await this.crawlerService.markSourceRun(sourceId, 'success');
      }
    } catch (error) {
      await this.crawlerService.finishRun(runId, 'failed', (error as Error).message);
      await this.crawlerService.markSourceRun(sourceId, 'failed', (error as Error).message);
      throw error;
    }
  }
}
