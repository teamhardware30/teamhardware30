import { describe, expect, it, vi } from 'vitest';
import { Database } from '../src/db/db.provider';
import { Job } from '../src/db/schema';
import { jobFingerprint, normalizeText } from '../src/modules/crawler/crawler.utils';
import { DedupeService } from '../src/modules/crawler/dedupe.service';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    sourceId: null,
    companyId: null,
    categoryId: null,
    externalId: null,
    fingerprint: 'abc',
    sourceUrl: 'https://example.com/jobs/1',
    applyUrl: null,
    title: 'Senior Backend Engineer',
    company: 'Acme',
    location: 'Nairobi, Kenya',
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
    descriptionHtml: '<p>Build things.</p>',
    descriptionText: 'Build things.',
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
    postedAt: new Date(),
    expiresAt: null,
    lastSeenAt: new Date(),
    lastCheckedAt: null,
    crawledAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('dedupe', () => {
  it('normalizes text before hashing', () => {
    expect(normalizeText('  Senior   Backend Engineer! ')).toBe('senior backend engineer');
    expect(jobFingerprint('Senior Backend Engineer', 'Acme', 'Nairobi')).toBe(
      jobFingerprint('senior backend engineer', 'ACME', 'nairobi'),
    );
    expect(jobFingerprint('Senior Backend Engineer', 'Acme', 'Nairobi')).not.toBe(
      jobFingerprint('Senior Backend Engineer', 'Acme', 'Mombasa'),
    );
  });

  it('returns the canonical job id when a near-duplicate exists', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ id: 'canonical-id' }] });
    const service = new DedupeService({ execute } as unknown as Database);

    await expect(service.findDuplicate(makeJob())).resolves.toBe('canonical-id');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('returns null when no near-duplicate exists', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const service = new DedupeService({ execute } as unknown as Database);

    await expect(service.findDuplicate(makeJob())).resolves.toBeNull();
  });

  it('does not query for jobs with an empty title or company', async () => {
    const execute = vi.fn();
    const service = new DedupeService({ execute } as unknown as Database);

    await expect(service.findDuplicate(makeJob({ title: '   ' }))).resolves.toBeNull();
    await expect(service.findDuplicate(makeJob({ company: '' }))).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});
