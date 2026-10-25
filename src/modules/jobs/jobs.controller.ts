import { Controller, Get, NotFoundException, Param, Query, Render } from '@nestjs/common';
import { JobsService, JobSearchParams, PostedWithin, POSTED_WITHIN_VALUES } from './jobs.service';
import { Job, Company, Category, Source } from '../../db/schema';

interface JobDetail extends Job {
  companyEntity: Company | null;
  category: Category | null;
  source: Source | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function single(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return single(value[0]);
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseParams(query: Record<string, unknown>): JobSearchParams {
  const postedWithin = single(query.postedWithin);
  return {
    q: single(query.q),
    category: single(query.category),
    location: single(query.location),
    remote: single(query.remote) === 'true' || single(query.remote) === '1',
    employmentType: single(query.employmentType),
    postedWithin: POSTED_WITHIN_VALUES.includes(postedWithin as PostedWithin)
      ? (postedWithin as PostedWithin)
      : undefined,
    cursor: single(query.cursor),
  };
}

function buildUrl(params: JobSearchParams, cursor?: string): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  if (params.location) search.set('location', params.location);
  if (params.remote) search.set('remote', 'true');
  if (params.employmentType) search.set('employmentType', params.employmentType);
  if (params.postedWithin) search.set('postedWithin', params.postedWithin);
  if (cursor) search.set('cursor', cursor);
  const qs = search.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get()
  @Render('jobs/index')
  async index(@Query() query: Record<string, unknown>) {
    const params = parseParams(query);
    const [result, facets] = await Promise.all([this.jobsService.search(params), this.jobsService.facets()]);
    const selectedCategory = facets.categories.find((category) => category.slug === params.category);

    return {
      jobs: result.jobs,
      total: result.total,
      nextCursor: result.nextCursor,
      nextUrl: result.nextCursor ? buildUrl(params, result.nextCursor) : null,
      isLoadMore: Boolean(params.cursor),
      filters: params,
      facets,
      selectedCategory,
      hasFilters: Boolean(
        params.q || params.category || params.location || params.remote || params.employmentType || params.postedWithin,
      ),
      pageTitle: params.q ? `“${params.q}” jobs` : 'Browse jobs',
    };
  }

  @Get(':id')
  @Render('jobs/show')
  async show(@Param('id') id: string) {
    if (!UUID_PATTERN.test(id)) {
      throw new NotFoundException('Job not found');
    }
    const job = (await this.jobsService.getJob(id)) as JobDetail | null;
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    return {
      job,
      pageTitle: `${job.title} at ${job.company} — Job Copilot`,
      metaDescription: truncate(job.descriptionText, 160),
      jsonLd: buildJsonLd(job),
    };
  }
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1).trimEnd()}…`;
}

function buildJsonLd(job: JobDetail): string {
  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: job.descriptionHtml,
    datePosted: (job.postedAt ?? job.createdAt).toISOString(),
    employmentType: job.employmentType ?? undefined,
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company,
      ...(job.companyEntity?.websiteUrl ? { sameAs: job.companyEntity.websiteUrl } : {}),
    },
    url: job.sourceUrl,
    directApply: job.applyMethod === 'onsite',
  };

  if (job.remote) {
    payload.jobLocationType = 'TELECOMMUTE';
  }
  if (job.city || job.country) {
    payload.jobLocation = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...(job.city ? { addressLocality: job.city } : {}),
        ...(job.country ? { addressCountry: job.country } : {}),
      },
    };
  }
  if (job.salaryMin || job.salaryMax) {
    payload.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency ?? 'USD',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salaryMin ? { minValue: job.salaryMin } : {}),
        ...(job.salaryMax ? { maxValue: job.salaryMax } : {}),
        unitText: (job.salaryPeriod ?? 'year').toUpperCase(),
      },
    };
  }

  return JSON.stringify(payload).replace(/</g, '\\u003c');
}
