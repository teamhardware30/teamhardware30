import { Controller, Get, Header, NotFoundException, Param, Query, Render } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Company, Category, Source } from '../../db/schema';
import { JobSearchParams, PostedWithin} from './jobs.service';
import { JobsService } from './jobs.service';
import { POSTED_WITHIN_VALUES } from './jobs.service';

interface JobDetail extends Job {
  companyEntity: Company | null;
  category: Category | null;
  source: Source | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(value: unknown, maxLength = 500): string | undefined {
  if (Array.isArray(value)) return single(value[0], maxLength);
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function salary(value: unknown): number | undefined {
  const raw = single(value, 20);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000_000_000 ? parsed : undefined;
}

function parseParams(query: Record<string, unknown>): JobSearchParams {
  const postedWithin = single(query.postedWithin);
  return {
    q: single(query.q, 300),
    category: single(query.category, 200),
    location: single(query.location, 300),
    remote: single(query.remote) === 'true' || single(query.remote) === '1',
    employmentType: single(query.employmentType, 50),
    salaryMin: salary(query.salaryMin ?? query.minSalary),
    salaryMax: salary(query.salaryMax ?? query.maxSalary),
    postedWithin: POSTED_WITHIN_VALUES.includes(postedWithin as PostedWithin)
      ? (postedWithin as PostedWithin)
      : undefined,
    cursor: single(query.cursor, 2_000),
  };
}

function buildUrl(params: JobSearchParams, cursor?: string): string {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  if (params.location) search.set('location', params.location);
  if (params.remote) search.set('remote', 'true');
  if (params.employmentType) search.set('employmentType', params.employmentType);
  if (params.salaryMin !== undefined) search.set('salaryMin', String(params.salaryMin));
  if (params.salaryMax !== undefined) search.set('salaryMax', String(params.salaryMax));
  if (params.postedWithin) search.set('postedWithin', params.postedWithin);
  if (cursor) search.set('cursor', cursor);
  const qs = search.toString();
  return qs ? `/jobs?${qs}` : '/jobs';
}

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
  ) {}

  @Get('categories')
  @Render('jobs/categories')
  async categories() {
    return { categories: await this.jobsService.listCategoriesWithCounts() };
  }

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
        params.q ||
          params.category ||
          params.location ||
          params.remote ||
          params.employmentType ||
          params.salaryMin !== undefined ||
          params.salaryMax !== undefined ||
          params.postedWithin,
      ),
      pageTitle: params.q ? `“${params.q}” jobs` : 'Browse jobs',
    };
  }

  @Get(':id')
  @Header('Cache-Control', 'public, max-age=300')
  @Render('jobs/show')
  async show(@Param('id') id: string) {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException('Job not found');
    const job = (await this.jobsService.getJob(id)) as JobDetail | null;
    if (!job) throw new NotFoundException('Job not found');

    const appUrl = (this.config.get<string>('APP_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    const canonicalUrl = `${appUrl}/jobs/${job.id}`;
    return {
      job,
      canonicalUrl,
      pageTitle: `${job.title} at ${job.company} — Job Copilot`,
      metaDescription: truncate(job.descriptionText, 160),
      jsonLd: buildJsonLd(job, canonicalUrl),
    };
  }
}

function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= length ? normalized : `${normalized.slice(0, length - 1).trimEnd()}…`;
}

function buildJsonLd(job: JobDetail, canonicalUrl: string): string {
  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    // Plain text cannot carry unsafe source markup into the structured data.
    description: job.descriptionText,
    datePosted: (job.postedAt ?? job.createdAt).toISOString(),
    validThrough: job.expiresAt?.toISOString(),
    employmentType: job.employmentType?.toUpperCase(),
    hiringOrganization: {
      '@type': 'Organization',
      name: job.company,
      ...(job.companyEntity?.websiteUrl ? { sameAs: job.companyEntity.websiteUrl } : {}),
    },
    url: canonicalUrl,
    mainEntityOfPage: canonicalUrl,
    ...(job.applyMethod === 'onsite' ? { directApply: true } : {}),
  };

  if (job.remote) {
    payload.jobLocationType = 'TELECOMMUTE';
    if (job.country) {
      payload.applicantLocationRequirements = { '@type': 'Country', name: job.country };
    }
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
  if (job.salaryMin !== null || job.salaryMax !== null) {
    payload.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency ?? 'USD',
      value: {
        '@type': 'QuantitativeValue',
        ...(job.salaryMin !== null ? { minValue: job.salaryMin } : {}),
        ...(job.salaryMax !== null ? { maxValue: job.salaryMax } : {}),
        unitText: (job.salaryPeriod ?? 'year').toUpperCase(),
      },
    };
  }

  return JSON.stringify(payload).replace(/</g, '\\u003c');
}
