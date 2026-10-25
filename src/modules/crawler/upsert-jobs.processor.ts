import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { jobs, Job as JobRow, NewJob } from '../../db/schema';
import { jobDtoSchema } from './dto/job.dto';
import { htmlToText, jobFingerprint } from './crawler.utils';
import { CrawlerService } from './crawler.service';
import { DEDUPE_QUEUE, UPSERT_JOBS_QUEUE } from './crawler.constants';

export interface UpsertJobsJobData {
  runId: string;
  sourceId: string;
  jobs: unknown[];
  isLastBatch: boolean;
}

interface DedupeJobData {
  runId: string;
  sourceId: string;
  jobIds: string[];
  isLastBatch: boolean;
  skipped: number;
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
    const { runId, sourceId, jobs: rawJobs, isLastBatch } = job.data;
    const created: string[] = [];
    const changed: string[] = [];
    let skipped = 0;

    try {
      for (const raw of rawJobs) {
        try {
          const dto = jobDtoSchema.parse(raw);
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
            lastSeenAt: now,
            crawledAt: now,
            updatedAt: now,
            isActive: true,
          };

          const existing = await this.findExisting(sourceId, dto.externalId, fingerprint);
          if (existing) {
            const didChange = hasChanged(existing, values);
            await this.db.update(jobs).set(values).where(eq(jobs.id, existing.id));
            if (didChange) {
              changed.push(existing.id);
            } else {
              skipped += 1;
            }
            continue;
          }

          try {
            const [inserted] = await this.db.insert(jobs).values(values).returning({ id: jobs.id });
            created.push(inserted.id);
          } catch (error) {
            if (!isUniqueViolation(error)) {
              throw error;
            }
            // Another batch inserted the same fingerprint first: update it.
            const conflicting = await this.db.query.jobs.findFirst({ where: eq(jobs.fingerprint, fingerprint) });
            if (!conflicting) {
              throw error;
            }
            await this.db.update(jobs).set(values).where(eq(jobs.id, conflicting.id));
            changed.push(conflicting.id);
          }
        } catch (error) {
          skipped += 1;
          this.logger.warn(`Skipping invalid job from source ${sourceId}: ${(error as Error).message}`);
        }
      }

      await this.crawlerService.incrementRun(runId, {
        created: created.length,
        updated: changed.length,
      });

      await this.dedupeQueue.add(
        'dedupe',
        { runId, sourceId, jobIds: [...created, ...changed], isLastBatch, skipped },
        { removeOnComplete: 1_000, removeOnFail: 5_000 },
      );
    } catch (error) {
      await this.crawlerService.finishRun(runId, 'failed', (error as Error).message);
      await this.crawlerService.markSourceRun(sourceId, 'failed', (error as Error).message);
      throw error;
    }
  }

  private async findExisting(
    sourceId: string,
    externalId: string | undefined,
    fingerprint: string,
  ): Promise<JobRow | null> {
    if (externalId) {
      const byExternalId = await this.db.query.jobs.findFirst({
        where: and(eq(jobs.sourceId, sourceId), eq(jobs.externalId, externalId)),
      });
      if (byExternalId) {
        return byExternalId;
      }
    }
    return (await this.db.query.jobs.findFirst({ where: eq(jobs.fingerprint, fingerprint) })) ?? null;
  }
}

function hasChanged(existing: JobRow, next: NewJob): boolean {
  const nextDescription = next.descriptionText ?? '';
  return (
    existing.title !== next.title ||
    existing.company !== next.company ||
    (existing.location ?? null) !== (next.location ?? null) ||
    (existing.city ?? null) !== (next.city ?? null) ||
    (existing.country ?? null) !== (next.country ?? null) ||
    existing.remote !== next.remote ||
    (existing.employmentType ?? null) !== (next.employmentType ?? null) ||
    existing.descriptionText !== nextDescription ||
    existing.descriptionHtml !== next.descriptionHtml ||
    (existing.applyUrl ?? null) !== (next.applyUrl ?? null) ||
    existing.applyMethod !== next.applyMethod ||
    (existing.applyEmail ?? null) !== (next.applyEmail ?? null) ||
    (existing.salaryMin ?? null) !== (next.salaryMin ?? null) ||
    (existing.salaryMax ?? null) !== (next.salaryMax ?? null) ||
    (existing.salaryCurrency ?? null) !== (next.salaryCurrency ?? null) ||
    (existing.salaryPeriod ?? null) !== (next.salaryPeriod ?? null) ||
    (existing.postedAt?.getTime() ?? null) !== ((next.postedAt as Date | null | undefined)?.getTime() ?? null) ||
    existing.isActive !== true
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
