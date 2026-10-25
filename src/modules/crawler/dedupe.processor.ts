import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { Job as JobRow } from '../../db/schema';
import { jobs } from '../../db/schema';
import { DEDUPE_QUEUE, ENRICH_JOB_QUEUE } from './crawler.constants';
import { CrawlerService } from './crawler.service';
import { jobContentHash, mergedJobFields } from './crawler.utils';
import { DedupeService } from './dedupe.service';

export interface DedupeJobData {
  runId: string;
  sourceId: string;
  jobIds: string[];
  batchIndex: number;
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
    const { runId, sourceId, jobIds, batchIndex, skipped } = job.data;
    let duplicates = 0;

    try {
      for (const jobId of jobIds) {
        const row = await this.crawlerService.findJobById(jobId);
        if (!row) {
          await this.crawlerService.recordRunErrors(runId, [
            { stage: 'dedupe', reason: `Job ${jobId} disappeared before dedupe` },
          ]);
          continue;
        }
        if (!row.isActive) continue;

        const duplicateOf = await this.dedupeService.findDuplicate(row);
        if (duplicateOf) {
          const canonical = await this.crawlerService.findJobById(duplicateOf);
          if (canonical) {
            const merged = mergedJobFields(canonical, row);
            if (Object.keys(merged).length > 0) {
              await this.db.update(jobs).set({ ...merged, updatedAt: new Date() }).where(eq(jobs.id, canonical.id));
              await this.enqueueEnrich({ ...canonical, ...merged });
            }
          }
          await this.db.update(jobs).set({ isActive: false, updatedAt: new Date() }).where(eq(jobs.id, row.id));
          duplicates += 1;
          this.logger.log(`Deactivated duplicate job ${row.id} (duplicate of ${duplicateOf})`);
          continue;
        }

        await this.enqueueEnrich(row);
      }

      await this.crawlerService.completeDedupeBatch(runId, sourceId, batchIndex, skipped + duplicates);
    } catch (error) {
      if (isFinalAttempt(job)) await this.crawlerService.failRun(runId, sourceId, error);
      throw error;
    }
  }

  private async enqueueEnrich(row: JobRow): Promise<void> {
    const contentHash = jobContentHash(row);
    await this.enrichQueue.add(
      'enrich',
      { jobId: row.id },
      {
        jobId: `enrich-${row.id}-${contentHash}`,
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );
  }
}

function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}
