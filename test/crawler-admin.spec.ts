import { BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { Database } from '../src/db/db.provider';
import { Source } from '../src/db/schema';
import { AdminService } from '../src/modules/admin/admin.service';
import { CrawlSourceJobData } from '../src/modules/crawler/crawler.scheduler';
import { CrawlerScheduler } from '../src/modules/crawler/crawler.scheduler';
import { CrawlerService } from '../src/modules/crawler/crawler.service';
import type { JobsService } from '../src/modules/jobs/jobs.service';

function source(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    name: `Source ${id}`,
    kind: 'html',
    baseUrl: 'https://example.com',
    config: {},
    cron: '0 */6 * * *',
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

describe('crawler scheduler synchronization', () => {
  it('upserts enabled sources and prunes only removed/disabled source schedulers', async () => {
    const crawler = { listEnabledSources: vi.fn().mockResolvedValue([source('one'), source('two')]) };
    const crawlQueue = {
      upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
      getJobSchedulers: vi.fn().mockResolvedValue([
        { id: 'source-one' },
        { id: 'source-disabled' },
        { id: 'unrelated-scheduler' },
      ]),
      removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    };
    const scheduler = new CrawlerScheduler(
      crawler as unknown as CrawlerService,
      crawlQueue as unknown as Queue<CrawlSourceJobData>,
      {} as Queue,
    );

    await scheduler.syncSchedulers();

    expect(crawlQueue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(crawlQueue.upsertJobScheduler.mock.calls.map((call) => call[0])).toEqual(['source-one', 'source-two']);
    expect(crawlQueue.removeJobScheduler).toHaveBeenCalledOnce();
    expect(crawlQueue.removeJobScheduler).toHaveBeenCalledWith('source-disabled');
  });
});

describe('admin Run now', () => {
  function adminDouble(selected: Source) {
    const crawler = { findSource: vi.fn().mockResolvedValue(selected) };
    const add = vi.fn().mockResolvedValue(undefined);
    const admin = new AdminService(
      {} as Database,
      crawler as unknown as CrawlerService,
      {} as CrawlerScheduler,
      {} as unknown as JobsService,
      { add } as unknown as Queue<CrawlSourceJobData>,
      { add: vi.fn() } as unknown as Queue<{ jobId: string }>,
    );
    return { admin, add };
  }

  it('uses a deterministic job ID to dedupe waiting/active manual runs', async () => {
    const { admin, add } = adminDouble(source('source-1'));
    await admin.runNow('source-1');
    expect(add).toHaveBeenCalledWith(
      'crawl-source',
      { sourceId: 'source-1', force: true },
      expect.objectContaining({ jobId: 'manual-source-1', removeOnComplete: true, removeOnFail: true }),
    );
  });

  it('refuses to enqueue a source whose kill switch is engaged', async () => {
    const { admin, add } = adminDouble(source('source-1', { killSwitch: true }));
    await expect(admin.runNow('source-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(add).not.toHaveBeenCalled();
  });
});
