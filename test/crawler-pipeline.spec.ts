import { Job, Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { Database } from '../src/db/db.provider';
import { CrawlRun, Source } from '../src/db/schema';
import { AdapterRegistry } from '../src/modules/crawler/adapters/adapter.registry';
import { AdapterSchemaError } from '../src/modules/crawler/adapters/errors';
import { SourceAdapter } from '../src/modules/crawler/adapters/source-adapter.interface';
import { CrawlSourceProcessor } from '../src/modules/crawler/crawl-source.processor';
import { UpsertJobsJobData } from '../src/modules/crawler/crawl-source.processor';
import { UPSERT_BATCH_SIZE } from '../src/modules/crawler/crawler.constants';
import { CrawlerService } from '../src/modules/crawler/crawler.service';
import { normalizeJobDto, rawItem } from '../src/modules/crawler/dto/job.dto';
import { JobDto} from '../src/modules/crawler/dto/job.dto';

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'source-1',
    name: 'Fixture source',
    kind: 'html',
    baseUrl: 'https://jobs.example.com',
    config: {},
    cron: '0 * * * *',
    enabled: true,
    killSwitch: false,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function dto(index: number): JobDto {
  return normalizeJobDto({
    externalId: String(index),
    sourceUrl: `https://jobs.example.com/jobs/${index}`,
    applyUrl: `https://jobs.example.com/jobs/${index}/apply`,
    title: `Engineer ${index}`,
    company: 'Acme',
    descriptionHtml: '<p>Build APIs</p>',
    descriptionText: 'Build APIs',
  });
}

function run(overrides: Partial<CrawlRun> = {}): CrawlRun {
  return {
    id: 'run-1',
    sourceId: 'source-1',
    status: 'running',
    startedAt: new Date(),
    finishedAt: null,
    jobsFound: 0,
    jobsCreated: 0,
    jobsUpdated: 0,
    jobsSkipped: 0,
    batchesTotal: 0,
    batchesCompleted: 0,
    processedUpsertBatches: [],
    processedDedupeBatches: [],
    errorCount: 0,
    errors: [],
    error: null,
    ...overrides,
  };
}

function bullJob<T>(data: T): Job<T> {
  return {
    data,
    attemptsMade: 0,
    opts: { attempts: 1 },
    updateData: vi.fn().mockResolvedValue(undefined),
  } as unknown as Job<T>;
}

function adapterFor(rows: JobDto[], invalid = 0): SourceAdapter {
  return {
    kind: 'html',
    async *fetch() {
      for (const job of rows) yield rawItem(job as unknown as Record<string, unknown>, { sourceUrl: job.sourceUrl });
      for (let index = 0; index < invalid; index += 1) {
        yield rawItem({}, { sourceUrl: `https://jobs.example.com/invalid/${index}`, error: 'Malformed detail' });
      }
    },
    normalize(raw) {
      if (Object.keys(raw.payload).length === 0) throw new AdapterSchemaError('Missing job');
      return raw.payload as unknown as JobDto;
    },
  };
}

function crawlerDouble() {
  return {
    findSource: vi.fn(),
    findRun: vi.fn(),
    startRun: vi.fn(),
    incrementRun: vi.fn(),
    setRunBatches: vi.fn(),
    recordRunErrors: vi.fn(),
    finishRun: vi.fn(),
    markSourceRun: vi.fn(),
    failRun: vi.fn(),
  };
}

describe('crawl pipeline coordination', () => {
  it('does not finalize a crawl until every upsert/dedupe batch completes', async () => {
    const selected = source();
    const rows = Array.from({ length: UPSERT_BATCH_SIZE + 1 }, (_, index) => dto(index));
    const crawler = crawlerDouble();
    crawler.findSource.mockResolvedValue(selected);
    crawler.startRun.mockResolvedValue(run());
    const add = vi.fn().mockResolvedValue(undefined);
    const processor = new CrawlSourceProcessor(
      crawler as unknown as CrawlerService,
      { get: () => adapterFor(rows) } as unknown as AdapterRegistry,
      { add } as unknown as Queue<UpsertJobsJobData>,
    );

    await processor.process(bullJob({ sourceId: selected.id }));

    expect(crawler.setRunBatches).toHaveBeenCalledWith('run-1', 2);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0][2]).toMatchObject({ jobId: 'upsert-run-1-0' });
    expect(add.mock.calls[1][2]).toMatchObject({ jobId: 'upsert-run-1-1' });
    expect(crawler.finishRun).not.toHaveBeenCalled();
    expect(crawler.markSourceRun).not.toHaveBeenCalled();
  });

  it('persists malformed item errors and fails a run with no valid records', async () => {
    const crawler = crawlerDouble();
    crawler.findSource.mockResolvedValue(source());
    crawler.startRun.mockResolvedValue(run());
    const processor = new CrawlSourceProcessor(
      crawler as unknown as CrawlerService,
      { get: () => adapterFor([], 2) } as unknown as AdapterRegistry,
      { add: vi.fn() } as unknown as Queue<UpsertJobsJobData>,
    );

    await processor.process(bullJob({ sourceId: 'source-1' }));

    expect(crawler.recordRunErrors).toHaveBeenCalledTimes(2);
    expect(crawler.recordRunErrors.mock.calls[0][1][0]).toMatchObject({ stage: 'fetch', reason: 'Malformed detail' });
    expect(crawler.finishRun).toHaveBeenCalledWith('run-1', 'failed', 'No valid jobs; 2 item error(s)');
    expect(crawler.markSourceRun).toHaveBeenCalledWith('source-1', 'failed', 'No valid jobs; 2 item error(s)');
  });

  it('resumes the same run on a BullMQ retry and does not process a finished run twice', async () => {
    const crawler = crawlerDouble();
    crawler.findSource.mockResolvedValue(source());
    crawler.findRun.mockResolvedValue(run({ status: 'success', finishedAt: new Date() }));
    const processor = new CrawlSourceProcessor(
      crawler as unknown as CrawlerService,
      { get: vi.fn() } as unknown as AdapterRegistry,
      { add: vi.fn() } as unknown as Queue<UpsertJobsJobData>,
    );

    await processor.process(bullJob({ sourceId: 'source-1', runId: 'run-1' }));
    expect(crawler.startRun).not.toHaveBeenCalled();
    expect(crawler.incrementRun).not.toHaveBeenCalled();
  });
});

describe('idempotent batch completion', () => {
  function serviceWithRun(returned: CrawlRun[]) {
    const returning = vi.fn().mockResolvedValue(returned);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    const service = new CrawlerService({ update } as unknown as Database);
    const finishRun = vi.spyOn(service, 'finishRun').mockResolvedValue(undefined);
    const markSourceRun = vi.spyOn(service, 'markSourceRun').mockResolvedValue(undefined);
    return { service, finishRun, markSourceRun, where };
  }

  it('keeps a run running while another batch is outstanding', async () => {
    const { service, finishRun, markSourceRun } = serviceWithRun([
      run({ batchesTotal: 2, batchesCompleted: 1 }),
    ]);
    await expect(service.completeDedupeBatch('run-1', 'source-1', 0, 0)).resolves.toBe(true);
    expect(finishRun).not.toHaveBeenCalled();
    expect(markSourceRun).not.toHaveBeenCalled();
  });

  it('finalizes the last batch as partial when item errors exist', async () => {
    const { service, finishRun, markSourceRun } = serviceWithRun([
      run({ batchesTotal: 2, batchesCompleted: 2, errorCount: 1, error: 'Bad item' }),
    ]);
    await service.completeDedupeBatch('run-1', 'source-1', 1, 0);
    expect(finishRun).toHaveBeenCalledWith('run-1', 'partial', 'Bad item');
    expect(markSourceRun).toHaveBeenCalledWith('source-1', 'partial', '1 item error(s)');
  });

  it('ignores a repeated batch marker instead of double-counting or finalizing twice', async () => {
    const { service, finishRun } = serviceWithRun([]);
    await expect(service.completeDedupeBatch('run-1', 'source-1', 1, 3)).resolves.toBe(false);
    expect(finishRun).not.toHaveBeenCalled();
  });
});
