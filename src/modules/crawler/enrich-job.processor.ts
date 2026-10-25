import { createHash } from 'crypto';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { jobs, categories } from '../../db/schema';
import { ENRICH_JOB_QUEUE } from './crawler.constants';
import { JobEnrichmentService } from './job-enrichment.service';

export { ENRICH_JOB_QUEUE };

@Processor(ENRICH_JOB_QUEUE, { concurrency: 2 })
export class EnrichJobProcessor extends WorkerHost {
  private readonly logger = new Logger(EnrichJobProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly enrichmentService: JobEnrichmentService,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    const [jobRow] = await this.db.select().from(jobs).where(eq(jobs.id, job.data.jobId));
    if (!jobRow) return;

    const contentHash = createHash('sha256').update(`${jobRow.title}\n${jobRow.descriptionText}`).digest('hex');
    if (jobRow.contentHash === contentHash && jobRow.enrichedAt) return;

    const categoryRows = await this.db.select({ slug: categories.slug }).from(categories);
    const categorySlugs = categoryRows.map((row) => row.slug);
    if (categorySlugs.length === 0) {
      this.logger.warn(`No categories available; skipping enrichment for ${jobRow.id}`);
      return;
    }

    const enrichment = await this.enrichmentService.enrich(
      {
        title: jobRow.title,
        company: jobRow.company,
        location: jobRow.location,
        descriptionText: jobRow.descriptionText,
      },
      categorySlugs,
    );

    const category = await this.db.query.categories.findFirst({ where: eq(categories.slug, enrichment.categorySlug) });
    const applyMethod = this.applyMethod(enrichment.applyEmail, jobRow.applyUrl);

    await this.db
      .update(jobs)
      .set({
        categoryId: category?.id ?? jobRow.categoryId,
        seniority: enrichment.seniority,
        employmentType: enrichment.employmentType,
        remoteType: enrichment.remoteType,
        remoteRegions: enrichment.remoteRegions ?? [],
        requiredSkills: enrichment.requiredSkills,
        preferredSkills: enrichment.preferredSkills,
        salaryMin: enrichment.salary.min ?? jobRow.salaryMin,
        salaryMax: enrichment.salary.max ?? jobRow.salaryMax,
        salaryCurrency: enrichment.salary.currency ?? jobRow.salaryCurrency,
        salaryPeriod: enrichment.salary.period ?? jobRow.salaryPeriod,
        applyEmail: enrichment.applyEmail ?? jobRow.applyEmail,
        applyMethod,
        summary: enrichment.summary,
        contentHash,
        enrichedAt: new Date(),
        enrichmentSource: 'llm',
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobRow.id));
  }

  private applyMethod(applyEmail: string | null, applyUrl: string | null): 'onsite' | 'email' | 'external_ats' {
    if (applyEmail && !applyUrl) return 'email';
    if (applyUrl) {
      try {
        const host = new URL(applyUrl).hostname.toLowerCase();
        if (host.includes('greenhouse') || host.includes('lever') || host.includes('ashby') || host.includes('workable') || host.includes('smartrecruiters')) {
          return 'external_ats';
        }
      } catch {
        return 'external_ats';
      }
      return 'external_ats';
    }
    return 'onsite';
  }
}
