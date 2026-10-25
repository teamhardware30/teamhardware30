import { Inject, Injectable } from '@nestjs/common';
import { SQL} from 'drizzle-orm';
import { and, count, desc, eq, gte, gt, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { Job } from '../../db/schema';
import { categories, jobs } from '../../db/schema';

export const POSTED_WITHIN_VALUES = ['24h', '7d', '30d'] as const;
export type PostedWithin = (typeof POSTED_WITHIN_VALUES)[number];

export interface JobSearchParams {
  q?: string;
  category?: string;
  location?: string;
  remote?: boolean;
  employmentType?: string;
  salaryMin?: number;
  salaryMax?: number;
  postedWithin?: PostedWithin;
  cursor?: string;
  limit?: number;
}

export interface JobSearchResult {
  jobs: Job[];
  nextCursor: string | null;
  total: number;
}

export interface JobFacets {
  categories: Array<{ id: string; name: string; slug: string; count: number }>;
  locations: Array<{ name: string; count: number }>;
  employmentTypes: Array<{ name: string; count: number }>;
}

interface Cursor {
  sortAt: string;
  id: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function encodeCursor(job: Job): string {
  const sortAt = (job.postedAt ?? job.createdAt).toISOString();
  return Buffer.from(JSON.stringify({ sortAt, id: job.id } satisfies Cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof parsed.sortAt !== 'string' || typeof parsed.id !== 'string') {
      return null;
    }
    const sortAt = new Date(parsed.sortAt);
    if (
      Number.isNaN(sortAt.getTime()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.id)
    ) {
      return null;
    }
    return { sortAt: sortAt.toISOString(), id: parsed.id };
  } catch {
    return null;
  }
}

@Injectable()
export class JobsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database, @Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async search(params: JobSearchParams): Promise<JobSearchResult> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const filters = await this.buildFilters(params);
    const cursor = decodeCursor(params.cursor);

    const conditions = [...filters];
    if (cursor) {
      conditions.push(
        sql`(coalesce(${jobs.postedAt}, ${jobs.createdAt}), ${jobs.id}) < (${cursor.sortAt}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    const rows = await this.db
      .select()
      .from(jobs)
      .where(and(...conditions))
      .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.createdAt})`), desc(jobs.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null;

    const [totalRow] = await this.db
      .select({ value: count() })
      .from(jobs)
      .where(and(...filters));

    return { jobs: page, nextCursor, total: Number(totalRow?.value ?? 0) };
  }

  async getJob(jobId: string) {
    return (
      (await this.db.query.jobs.findFirst({
        where: and(
          eq(jobs.id, jobId),
          eq(jobs.isActive, true),
          or(isNull(jobs.expiresAt), gt(jobs.expiresAt, new Date())),
        ),
        with: { companyEntity: true, category: true, source: true },
      })) ?? null
    );
  }

  async facets(): Promise<JobFacets> {
    const [categoryRows, locationRows, employmentRows] = await Promise.all([
      this.db
        .select({ id: categories.id, name: categories.name, slug: categories.slug, value: count() })
        .from(jobs)
        .innerJoin(categories, eq(jobs.categoryId, categories.id))
        .where(eq(jobs.isActive, true))
        .groupBy(categories.id, categories.name, categories.slug)
        .orderBy(desc(count()))
        .limit(20),
      this.db
        .select({ name: jobs.city, value: count() })
        .from(jobs)
        .where(and(eq(jobs.isActive, true), isNotNull(jobs.city)))
        .groupBy(jobs.city)
        .orderBy(desc(count()))
        .limit(15),
      this.db
        .select({ name: jobs.employmentType, value: count() })
        .from(jobs)
        .where(and(eq(jobs.isActive, true), isNotNull(jobs.employmentType)))
        .groupBy(jobs.employmentType)
        .orderBy(desc(count()))
        .limit(10),
    ]);

    return {
      categories: categoryRows.map((row) => ({ id: row.id, name: row.name, slug: row.slug, count: Number(row.value) })),
      locations: locationRows
        .filter((row): row is { name: string; value: number } => Boolean(row.name))
        .map((row) => ({ name: row.name, count: Number(row.value) })),
      employmentTypes: employmentRows
        .filter((row): row is { name: string; value: number } => Boolean(row.name))
        .map((row) => ({ name: row.name, count: Number(row.value) })),
    };
  }

  async createJob(data: Partial<Job>): Promise<Job> {
    const [job] = await this.db.insert(jobs).values(data as never).returning();
    return job;
  }

  async listSitemapJobs(limit: number): Promise<Job[]> {
    return this.db.select().from(jobs).where(eq(jobs.isActive, true)).orderBy(desc(jobs.updatedAt)).limit(limit);
  }

  async findById(jobId: string): Promise<Job | null> {
    const [job] = await this.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return job ?? null;
  }

  async listCategorySlugs(): Promise<string[]> {
    const rows = await this.db.select({ slug: categories.slug }).from(categories);
    return rows.map((row) => row.slug);
  }

  async applyEnrichment(jobId: string, enrichment: { categorySlug: string; seniority: string; employmentType: string; remoteType: string; remoteRegions: string[]; requiredSkills: string[]; preferredSkills: string[]; minYearsExperience: number | null; educationLevel: string | null; salary: { min: number | null; max: number | null; currency: string | null; period: 'year' | 'month' | 'hour' | null }; applyEmail: string | null; summary: string }, contentHash: string): Promise<void> {
    const category = await this.db.query.categories.findFirst({ where: eq(categories.slug, enrichment.categorySlug) });
    await this.db
      .update(jobs)
      .set({
        categoryId: category?.id ?? null,
        seniority: enrichment.seniority,
        employmentType: enrichment.employmentType,
        remoteType: enrichment.remoteType,
        remoteRegions: enrichment.remoteRegions,
        requiredSkills: enrichment.requiredSkills,
        preferredSkills: enrichment.preferredSkills,
        salaryMin: enrichment.salary.min,
        salaryMax: enrichment.salary.max,
        salaryCurrency: enrichment.salary.currency,
        salaryPeriod: enrichment.salary.period,
        applyEmail: enrichment.applyEmail,
        summary: enrichment.summary,
        contentHash,
        enrichedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  async listCategoriesWithCounts(): Promise<Array<{ slug: string; name: string; count: number; children: Array<{ slug: string; name: string; count: number }> }>> {
    const cacheKey = 'jobs:categories:counts';
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Array<{ slug: string; name: string; count: number; children: Array<{ slug: string; name: string; count: number }> }>;

    const families = await this.db.select({ id: categories.id, slug: categories.slug, name: categories.name }).from(categories).where(sql`${categories.parentId} is null`);
    const counts = await this.db
      .select({ categoryId: jobs.categoryId, value: count() })
      .from(jobs)
      .where(eq(jobs.isActive, true))
      .groupBy(jobs.categoryId);

    const countByCategory = new Map(counts.map((row) => [row.categoryId, Number(row.value)]));
    const allCategories = await this.db.select({ id: categories.id, slug: categories.slug, name: categories.name, parentId: categories.parentId }).from(categories);
    const childrenByParent = new Map<string, Array<{ slug: string; name: string; count: number }>>();

    for (const category of allCategories) {
      if (!category.parentId) continue;
      const children = childrenByParent.get(category.parentId) ?? [];
      children.push({ slug: category.slug, name: category.name, count: countByCategory.get(category.id) ?? 0 });
      childrenByParent.set(category.parentId, children);
    }

    const result = families.map((family) => ({
      slug: family.slug,
      name: family.name,
      count: countByCategory.get(family.id) ?? 0,
      children: childrenByParent.get(family.id) ?? [],
    }));

    await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
    return result;
  }

  async findJobsForReenrichment(from: Date, to: Date, limit: number): Promise<Job[]> {
    return this.db
      .select()
      .from(jobs)
      .where(and(gte(jobs.createdAt, from), lte(jobs.createdAt, to)))
      .limit(limit);
  }

  private async buildFilters(params: JobSearchParams): Promise<SQL[]> {
    const filters: SQL[] = [
      eq(jobs.isActive, true),
      or(isNull(jobs.expiresAt), gt(jobs.expiresAt, new Date())) as SQL,
    ];

    if (params.q?.trim()) {
      const query = params.q.trim();
      const fullText = sql`${jobs.searchVector} @@ websearch_to_tsquery('english', ${query})`;
      // Trigram/ILIKE keeps title matches useful for punctuation, names and stop words.
      const titleFallback = or(
        sql`similarity(lower(${jobs.title}), lower(${query})) > 0.2`,
        ilike(jobs.title, `%${query}%`),
      );
      const combined = or(fullText, titleFallback);
      if (combined) filters.push(combined);
    }

    if (params.category) {
      const category = await this.db.query.categories.findFirst({ where: eq(categories.slug, params.category) });
      filters.push(category ? eq(jobs.categoryId, category.id) : sql`false`);
    }

    if (params.location?.trim()) {
      const pattern = `%${params.location.trim()}%`;
      const locationFilter = or(ilike(jobs.location, pattern), ilike(jobs.city, pattern), ilike(jobs.country, pattern));
      if (locationFilter) {
        filters.push(locationFilter);
      }
    }

    if (params.remote) {
      filters.push(eq(jobs.remote, true));
    }

    if (params.employmentType) {
      filters.push(eq(jobs.employmentType, params.employmentType));
    }

    if (params.salaryMin !== undefined) {
      filters.push(sql`coalesce(${jobs.salaryMax}, ${jobs.salaryMin}) >= ${params.salaryMin}`);
    }

    if (params.salaryMax !== undefined) {
      filters.push(sql`coalesce(${jobs.salaryMin}, ${jobs.salaryMax}) <= ${params.salaryMax}`);
    }

    if (params.postedWithin) {
      const days = params.postedWithin === '24h' ? 1 : params.postedWithin === '7d' ? 7 : 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filters.push(sql`coalesce(${jobs.postedAt}, ${jobs.createdAt}) >= ${cutoff}`);
    }

    return filters;
  }
}
