import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AdapterRegistry } from './adapters/adapter.registry';
import { asString } from './adapters/source-adapter.interface';
import { CRAWL_SOURCE_QUEUE, UPSERT_BATCH_SIZE, UPSERT_JOBS_QUEUE } from './crawler.constants';
import { CrawlerService } from './crawler.service';
import { NewRunItemError } from './crawler.service';
import { JobDto, RawItem } from './dto/job.dto';
import { jobDtoSchema } from './dto/job.dto';

export interface CrawlSourceJobData {
  sourceId: string;
  force?: boolean;
  /** Persisted on the BullMQ job so a retry resumes the same crawl run. */
  runId?: string;
}

export interface UpsertJobsJobData {
  runId: string;
  sourceId: string;
  jobs: JobDto[];
  batchIndex: number;
}

@Processor(CRAWL_SOURCE_QUEUE)
export class CrawlSourceProcessor extends WorkerHost {
  private readonly logger = new Logger(CrawlSourceProcessor.name);

  constructor(
    private readonly crawlerService: CrawlerService,
    private readonly registry: AdapterRegistry,
    @InjectQueue(UPSERT_JOBS_QUEUE) private readonly upsertQueue: Queue<UpsertJobsJobData>,
  ) {
    super();
  }

  async process(job: Job<CrawlSourceJobData>): Promise<void> {
    const source = await this.crawlerService.findSource(job.data.sourceId);
    if (!source) {
      this.logger.warn(`Source ${job.data.sourceId} no longer exists; skipping`);
      return;
    }
    if (source.killSwitch) {
      this.logger.warn(`Source ${source.name} is stopped by its kill switch; skipping`);
      return;
    }
    if (!source.enabled && !job.data.force) {
      this.logger.log(`Source ${source.name} is disabled; skipping`);
      return;
    }

    let run = job.data.runId ? await this.crawlerService.findRun(job.data.runId) : null;
    if (run && run.status !== 'running') return;
    if (!run) {
      run = await this.crawlerService.startRun(source.id);
      await job.updateData({ ...job.data, runId: run.id });
    }

    const normalized: JobDto[] = [];
    let found = 0;
    let invalid = 0;

    try {
      const adapter = this.registry.get(source.kind);
      for await (const raw of adapter.fetch(source)) {
        found += 1;
        if (raw.metadata.error) {
          invalid += 1;
          await this.recordErrors(run.id, raw, 'fetch', raw.metadata.error);
          continue;
        }
        if (raw.metadata.warnings?.length) {
          await this.crawlerService.recordRunErrors(
            run.id,
            raw.metadata.warnings.map((reason) => this.errorFromRaw(raw, 'fetch', reason)),
            false,
          );
        }
        try {
          // Keep this boundary even for third-party adapters that do not self-validate.
          normalized.push(jobDtoSchema.parse(adapter.normalize(raw)));
        } catch (error) {
          invalid += 1;
          await this.recordErrors(run.id, raw, 'normalize', error);
        }
      }

      await this.crawlerService.incrementRun(run.id, { found });
      if (normalized.length === 0) {
        const status = invalid > 0 ? 'failed' : 'success';
        const message = invalid > 0 ? `No valid jobs; ${invalid} item error(s)` : 'No jobs returned';
        await this.crawlerService.finishRun(run.id, status, invalid > 0 ? message : undefined);
        await this.crawlerService.markSourceRun(source.id, status, message);
        return;
      }

      const batches = chunk(normalized, UPSERT_BATCH_SIZE);
      await this.crawlerService.setRunBatches(run.id, batches.length);
      for (let index = 0; index < batches.length; index += 1) {
        await this.upsertQueue.add(
          'upsert',
          { runId: run.id, sourceId: source.id, jobs: batches[index], batchIndex: index },
          {
            jobId: `upsert-${run.id}-${index}`,
            removeOnComplete: 1_000,
            removeOnFail: 5_000,
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
          },
        );
      }
      this.logger.log(`Crawl of ${source.name} fetched ${found} jobs in ${batches.length} batch(es)`);
    } catch (error) {
      await this.crawlerService.failRun(run.id, source.id, error);
      throw error;
    }
  }

  private async recordErrors(runId: string, raw: RawItem, stage: NewRunItemError['stage'], error: unknown): Promise<void> {
    await this.crawlerService.recordRunErrors(runId, [this.errorFromRaw(raw, stage, error)]);
  }

  private errorFromRaw(raw: RawItem, stage: NewRunItemError['stage'], error: unknown): NewRunItemError {
    return {
      stage,
      reason: error instanceof Error ? error.message : String(error),
      sourceUrl: raw.metadata.sourceUrl,
      externalId: asString(raw.payload.externalId ?? raw.payload.id ?? raw.payload.slug),
    };
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
