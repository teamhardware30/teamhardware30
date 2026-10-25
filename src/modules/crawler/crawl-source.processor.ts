import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { CrawlerService } from './crawler.service';
import { AdapterRegistry } from './adapters/adapter.registry';
import { jobDtoSchema, JobDto } from './dto/job.dto';
import { CRAWL_SOURCE_QUEUE, UPSERT_BATCH_SIZE, UPSERT_JOBS_QUEUE } from './crawler.constants';

export interface CrawlSourceJobData {
  sourceId: string;
  force?: boolean;
}

interface UpsertJobsJobData {
  runId: string;
  sourceId: string;
  jobs: JobDto[];
  isLastBatch: boolean;
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
    if (!source.enabled && !job.data.force) {
      this.logger.log(`Source ${source.name} is disabled; skipping`);
      return;
    }
    const run = await this.crawlerService.startRun(source.id);
    const normalized: JobDto[] = [];
    let invalid = 0;

    try {
      const adapter = this.registry.get(source.kind);
      for await (const raw of adapter.fetch(source)) {
        try {
          normalized.push(jobDtoSchema.parse(adapter.normalize(raw)));
        } catch (error) {
          invalid += 1;
          this.logger.warn(`Discarding invalid job from ${source.name}: ${(error as Error).message}`);
        }
      }

      await this.crawlerService.incrementRun(run.id, { found: normalized.length + invalid, skipped: invalid });

      if (normalized.length === 0) {
        await this.crawlerService.finishRun(run.id, 'success');
        await this.crawlerService.markSourceRun(source.id, 'success', 'No jobs returned');
        this.logger.log(`Crawl of ${source.name} finished with no jobs`);
        return;
      }

      const batches = chunk(normalized, UPSERT_BATCH_SIZE);
      for (let index = 0; index < batches.length; index += 1) {
        await this.upsertQueue.add(
          'upsert',
          {
            runId: run.id,
            sourceId: source.id,
            jobs: batches[index],
            isLastBatch: index === batches.length - 1,
          },
          { removeOnComplete: 1_000, removeOnFail: 5_000, attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
        );
      }

      this.logger.log(`Crawl of ${source.name} fetched ${normalized.length} jobs in ${batches.length} batch(es)`);
    } catch (error) {
      await this.crawlerService.finishRun(run.id, 'failed', (error as Error).message);
      await this.crawlerService.markSourceRun(source.id, 'failed', (error as Error).message);
      throw error;
    }
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
