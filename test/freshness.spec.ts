import { Job as BullJob, Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { Database } from '../src/db/db.provider';
import { Job } from '../src/db/schema';
import { LINK_CHECK_INTERVAL_DAYS, STALE_AFTER_DAYS } from '../src/modules/crawler/crawler.constants';
import { CrawlerService } from '../src/modules/crawler/crawler.service';
import { jobFingerprint } from '../src/modules/crawler/crawler.utils';
import { normalizeJobDto } from '../src/modules/crawler/dto/job.dto';
import { CrawlerHttp } from '../src/modules/crawler/http';
import { MaintenanceProcessor } from '../src/modules/crawler/maintenance.processor';
import { DedupeJobData} from '../src/modules/crawler/upsert-jobs.processor';
import { UpsertJobsProcessor } from '../src/modules/crawler/upsert-jobs.processor';

function makeJob(overrides: Partial<Job> = {}): Job {
  const now = new Date();
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sourceId: 'source-1',
    companyId: null,
    categoryId: null,
    externalId: '1',
    fingerprint: jobFingerprint('Engineer', 'Acme', 'Nairobi'),
    sourceUrl: 'https://example.com/jobs/1',
    applyUrl: 'https://example.com/jobs/1/apply',
    title: 'Engineer',
    company: 'Acme',
    location: 'Nairobi',
    city: 'Nairobi',
    country: 'Kenya',
    remote: false,
    employmentType: 'full_time',
    seniority: null,
    remoteType: null,
    remoteRegions: [],
    requiredSkills: [],
    preferredSkills: [],
    contentHash: null,
    enrichedAt: null,
    enrichmentSource: null,
    descriptionHtml: '<p>Build APIs</p>',
    descriptionText: 'Build APIs',
    summary: null,
    employerId: null,
    skills: [],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    applyMethod: 'external_ats',
    applyEmail: null,
    embedding: null,
    searchVector: '',
    isActive: true,
    postedAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    lastSeenAt: now,
    lastCheckedAt: null,
    crawledAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeDto() {
  return normalizeJobDto({
    externalId: '1',
    sourceUrl: 'https://example.com/jobs/1',
    applyUrl: 'https://example.com/jobs/1/apply',
    title: 'Engineer',
    company: 'Acme',
    location: 'Nairobi',
    city: 'Nairobi',
    country: 'Kenya',
    remote: false,
    employmentType: 'full_time',
    seniority: null,
    remoteType: null,
    remoteRegions: [],
    requiredSkills: [],
    preferredSkills: [],
    contentHash: null,
    enrichedAt: null,
    enrichmentSource: null,
    descriptionHtml: '<p>Build APIs</p>',
    descriptionText: 'Build APIs',
    postedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function upsertHarness(existing: Job) {
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const findFirst = vi.fn().mockResolvedValue(existing);
  const db = { update, query: { jobs: { findFirst } } } as unknown as Database;
  const crawler = {
    resolveCompanyId: vi.fn().mockResolvedValue(null),
    resolveCategoryId: vi.fn().mockResolvedValue(null),
    recordRunErrors: vi.fn().mockResolvedValue(undefined),
    markUpsertBatch: vi.fn().mockResolvedValue(true),
    failRun: vi.fn().mockResolvedValue(undefined),
  };
  const add = vi.fn().mockResolvedValue(undefined);
  const processor = new UpsertJobsProcessor(
    db,
    crawler as unknown as CrawlerService,
    { add } as unknown as Queue<DedupeJobData>,
  );
  return { processor, crawler, add, set };
}

function upsertJob(dto = makeDto()): BullJob<{ runId: string; sourceId: string; jobs: unknown[]; batchIndex: number }> {
  return {
    data: { runId: 'run-1', sourceId: 'source-1', jobs: [dto], batchIndex: 0 },
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as BullJob<{ runId: string; sourceId: string; jobs: unknown[]; batchIndex: number }>;
}

describe('upsert freshness and enrichment eligibility', () => {
  it('does not enqueue enrichment for an unchanged record', async () => {
    const existing = makeJob();
    const { processor, add, crawler } = upsertHarness(existing);
    await processor.process(upsertJob());
    expect(add.mock.calls[0][1]).toMatchObject({ jobIds: [], skipped: 1 });
    expect(crawler.markUpsertBatch).toHaveBeenCalledWith('run-1', 0, { created: 0, updated: 0 });
  });

  it('reactivates a previously dead job when seen again and enriches the change', async () => {
    const checked = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const existing = makeJob({ isActive: false, lastCheckedAt: checked });
    const { processor, add, set } = upsertHarness(existing);
    await processor.process(upsertJob());
    expect(add.mock.calls[0][1]).toMatchObject({ jobIds: [existing.id], skipped: 0 });
    const values = (set.mock.calls as unknown[][])[0][0] as { isActive: boolean; lastCheckedAt: Date };
    expect(values.isActive).toBe(true);
    expect(values.lastCheckedAt.getTime()).toBeGreaterThan(checked.getTime());
  });

  it('does not reactivate a posting whose expiresAt is still in the past', async () => {
    const expired = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existing = makeJob({ isActive: false, expiresAt: expired });
    const { processor, add, set } = upsertHarness(existing);
    await processor.process(upsertJob(normalizeJobDto({ ...makeDto(), expiresAt: expired })));
    expect(((set.mock.calls as unknown[][])[0][0] as { isActive: boolean }).isActive).toBe(false);
    expect(add.mock.calls[0][1]).toMatchObject({ jobIds: [], skipped: 0 });
  });
});

describe('weekly freshness maintenance', () => {
  it('uses 45 days unseen and seven-day HEAD checks, deactivating only 404/410', async () => {
    expect(STALE_AFTER_DAYS).toBe(45);
    expect(LINK_CHECK_INTERVAL_DAYS).toBe(7);
    const due = [404, 410, 403, 200].map((status, index) =>
      makeJob({ id: `job-${index}`, applyUrl: `https://example.com/${status}` }),
    );
    const timeout = makeJob({ id: 'timeout', applyUrl: 'https://example.com/timeout' });
    const crawler = {
      deactivateExpiredAndStaleJobs: vi.fn().mockResolvedValue({ expired: 1, stale: 2 }),
      listJobsDueForLinkCheck: vi.fn().mockResolvedValue([...due, timeout]),
      findSource: vi.fn().mockResolvedValue(null),
      recordLinkCheck: vi.fn().mockResolvedValue(undefined),
    };
    const head = vi.fn(async (url: string) => {
      if (url.endsWith('timeout')) throw new Error('timeout');
      return { status: Number(url.split('/').pop()), url, body: '', notModified: false };
    });
    const processor = new MaintenanceProcessor(
      crawler as unknown as CrawlerService,
      { head } as unknown as CrawlerHttp,
    );

    await processor.process({ name: 'deactivate-stale-jobs' } as BullJob);

    expect(crawler.deactivateExpiredAndStaleJobs).toHaveBeenCalledOnce();
    expect(crawler.recordLinkCheck).toHaveBeenCalledTimes(5);
    expect(crawler.recordLinkCheck.mock.calls.map((call) => call[1])).toEqual([true, true, false, false, false]);
    for (const call of crawler.recordLinkCheck.mock.calls) expect(call[2]).toBeInstanceOf(Date);
  });
});
