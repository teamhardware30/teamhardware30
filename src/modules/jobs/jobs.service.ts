import { Inject, Injectable } from '@nestjs/common';
import { SQL, and, count, desc, eq, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { categories, jobs, Job } from '../../db/schema';

export const POSTED_WITHIN_VALUES = ['24h', '7d', '30d'] as const;
export type PostedWithin = (typeof POSTED_WITHIN_VALUES)[number];

export interface JobSearchParams {
  q?: string;
  category?: string;
  location?: string;
  remote?: boolean;
  employmentType?: string;
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
    return { sortAt: parsed.sortAt, id: parsed.id };
  } catch {
    return null;
  }
}

@Injectable()
export class JobsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
        where: eq(jobs.id, jobId),
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

  private async buildFilters(params: JobSearchParams): Promise<SQL[]> {
    const filters: SQL[] = [eq(jobs.isActive, true)];

    if (params.q?.trim()) {
      filters.push(sql`${jobs.searchVector} @@ websearch_to_tsquery('english', ${params.q.trim()})`);
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

    if (params.postedWithin) {
      const days = params.postedWithin === '24h' ? 1 : params.postedWithin === '7d' ? 7 : 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filters.push(sql`coalesce(${jobs.postedAt}, ${jobs.createdAt}) >= ${cutoff}`);
    }

    return filters;
  }
}
