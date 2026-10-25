import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { Job as JobRow, NewJob } from '../../db/schema';
import { jobs } from '../../db/schema';
import { DEDUPE_QUEUE, UPSERT_JOBS_QUEUE } from './crawler.constants';
import { CrawlerService } from './crawler.service';
import { htmlToText, jobFingerprint } from './crawler.utils';
import { JobDto} from './dto/job.dto';
import { jobDtoSchema } from './dto/job.dto';

export interface UpsertJobsJobData {
  runId: string;
  sourceId: string;
  jobs: unknown[];
  batchIndex: number;
}

export interface DedupeJobData {
  runId: string;
  sourceId: string;
  jobIds: string[];
  batchIndex: number;
  skipped: number;
}

interface UpsertResult {
  id: string;
  created: boolean;
  changed: boolean;
}

@Processor(UPSERT_JOBS_QUEUE)
export class UpsertJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(UpsertJobsProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly crawlerService: CrawlerService,
    @InjectQueue(DEDUPE_QUEUE) private readonly dedupeQueue: Queue<DedupeJobData>,
  ) {
    super();
  }

  async process(job: Job<UpsertJobsJobData>): Promise<void> {
    const { runId, sourceId, jobs: rawJobs, batchIndex } = job.data;
    const created: string[] = [];
    const changed: string[] = [];
    let unchanged = 0;

    try {
      for (const raw of rawJobs) {
        let dto: JobDto;
        try {
          dto = jobDtoSchema.parse(raw);
        } catch (error) {
          if (!(error instanceof ZodError)) throw error;
          await this.crawlerService.recordRunErrors(runId, [
            { stage: 'upsert', reason: error.message, sourceUrl: sourceUrlOf(raw) },
          ]);
          continue;
        }

        const result = await this.upsertOne(sourceId, dto);
        const isActive = !dto.expiresAt || dto.expiresAt.getTime() > Date.now();
        if (result.created) created.push(result.id);
        else if (result.changed) changed.push(result.id);
        else if (isActive) unchanged += 1;
      }

      // Enqueue first with a deterministic ID, then mark counters exactly once. A
      // crash/retry anywhere in this sequence cannot double-count or lose the batch.
      await this.dedupeQueue.add(
        'dedupe',
        { runId, sourceId, jobIds: [...created, ...changed], batchIndex, skipped: unchanged },
        {
          jobId: `dedupe-${runId}-${batchIndex}`,
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
      await this.crawlerService.markUpsertBatch(runId, batchIndex, {
        created: created.length,
        updated: changed.length,
      });
    } catch (error) {
      if (isFinalAttempt(job)) await this.crawlerService.failRun(runId, sourceId, error);
      throw error;
    }
  }

  private async upsertOne(sourceId: string, dto: JobDto): Promise<UpsertResult> {
    const fingerprint = jobFingerprint(dto.title, dto.company, dto.city ?? dto.location);
    const companyId = await this.crawlerService.resolveCompanyId(dto.company);
    const categoryId = await this.crawlerService.resolveCategoryId(dto.category);
    const now = new Date();
    const values: NewJob = {
      sourceId,
      companyId,
      categoryId,
      externalId: dto.externalId ?? null,
      fingerprint,
      sourceUrl: dto.sourceUrl,
      applyUrl: dto.applyUrl ?? null,
      title: dto.title,
      company: dto.company,
      location: dto.location ?? null,
      city: dto.city ?? null,
      country: dto.country ?? null,
      remote: dto.remote,
      employmentType: dto.employmentType ?? null,
      descriptionHtml: dto.descriptionHtml,
      descriptionText: dto.descriptionText ?? htmlToText(dto.descriptionHtml),
      skills: dto.skills,
      salaryMin: dto.salaryMin ?? null,
      salaryMax: dto.salaryMax ?? null,
      salaryCurrency: dto.salaryCurrency ?? null,
      salaryPeriod: dto.salaryPeriod ?? null,
      applyMethod: dto.applyMethod,
      applyEmail: dto.applyEmail ?? null,
      postedAt: dto.postedAt ?? null,
      expiresAt: dto.expiresAt ?? null,
      lastSeenAt: now,
      crawledAt: now,
      updatedAt: now,
      isActive: !dto.expiresAt || dto.expiresAt.getTime() > now.getTime(),
    };

    const byExternalId = dto.externalId ? await this.findByExternalId(sourceId, dto.externalId) : null;
    const byFingerprint = await this.findByFingerprint(fingerprint);
    const existing = byExternalId ?? byFingerprint;

    if (byExternalId && byFingerprint && byExternalId.id !== byFingerprint.id) {
      await this.db.update(jobs).set({ isActive: false, updatedAt: now }).where(eq(jobs.id, byExternalId.id));
      return this.updateExisting(byFingerprint, values, now, true);
    }
    if (existing) return this.updateExisting(existing, values, now, existing.id !== byExternalId?.id);

    try {
      const [inserted] = await this.db.insert(jobs).values(values).returning({ id: jobs.id });
      return { id: inserted.id, created: true, changed: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const conflicting =
        (dto.externalId ? await this.findByExternalId(sourceId, dto.externalId) : null) ??
        (await this.findByFingerprint(fingerprint));
      if (!conflicting) throw error;
      return this.updateExisting(conflicting, values, now, true);
    }
  }

  private async updateExisting(existing: JobRow, next: NewJob, now: Date, canonicalMerge: boolean): Promise<UpsertResult> {
    const values: NewJob = {
      ...next,
      lastCheckedAt: next.isActive && !existing.isActive ? now : existing.lastCheckedAt,
    };
    if (canonicalMerge) {
      // Keep one stable source identity while refreshing useful canonical fields.
      values.sourceId = existing.sourceId;
      values.externalId = existing.externalId;
      values.sourceUrl = existing.sourceUrl;
      values.applyUrl = existing.applyUrl ?? next.applyUrl;
      values.postedAt = existing.postedAt ?? next.postedAt;
    }
    const didChange = hasChanged(existing, values);
    await this.db.update(jobs).set(values).where(eq(jobs.id, existing.id));
    return { id: existing.id, created: false, changed: didChange };
  }

  private findByExternalId(sourceId: string, externalId: string): Promise<JobRow | null> {
    return this.db.query.jobs.findFirst({
      where: and(eq(jobs.sourceId, sourceId), eq(jobs.externalId, externalId)),
    }) as Promise<JobRow | null>;
  }

  private findByFingerprint(fingerprint: string): Promise<JobRow | null> {
    return this.db.query.jobs.findFirst({ where: eq(jobs.fingerprint, fingerprint) }) as Promise<JobRow | null>;
  }
}

export function hasChanged(existing: JobRow, next: NewJob): boolean {
  return (
    existing.title !== next.title ||
    existing.company !== next.company ||
    existing.categoryId !== next.categoryId ||
    (existing.location ?? null) !== (next.location ?? null) ||
    (existing.city ?? null) !== (next.city ?? null) ||
    (existing.country ?? null) !== (next.country ?? null) ||
    existing.remote !== next.remote ||
    (existing.employmentType ?? null) !== (next.employmentType ?? null) ||
    existing.descriptionText !== (next.descriptionText ?? '') ||
    existing.descriptionHtml !== next.descriptionHtml ||
    JSON.stringify(existing.skills) !== JSON.stringify(next.skills ?? []) ||
    (existing.sourceUrl ?? null) !== (next.sourceUrl ?? null) ||
    (existing.applyUrl ?? null) !== (next.applyUrl ?? null) ||
    existing.applyMethod !== next.applyMethod ||
    (existing.applyEmail ?? null) !== (next.applyEmail ?? null) ||
    (existing.salaryMin ?? null) !== (next.salaryMin ?? null) ||
    (existing.salaryMax ?? null) !== (next.salaryMax ?? null) ||
    (existing.salaryCurrency ?? null) !== (next.salaryCurrency ?? null) ||
    (existing.salaryPeriod ?? null) !== (next.salaryPeriod ?? null) ||
    dateValue(existing.postedAt) !== dateValue(next.postedAt) ||
    dateValue(existing.expiresAt) !== dateValue(next.expiresAt) ||
    existing.isActive !== next.isActive
  );
}

function dateValue(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function sourceUrlOf(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = (raw as Record<string, unknown>).sourceUrl;
  return typeof value === 'string' ? value : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

function isFinalAttempt(job: Job): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}
