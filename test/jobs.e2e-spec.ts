import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './setup-e2e';
import { DRIZZLE, Database } from '../src/db/db.provider';
import { categories, jobs } from '../src/db/schema';
import { jobFingerprint } from '../src/modules/crawler/crawler.utils';

describe('Jobs (e2e)', () => {
  let ctx: TestContext;
  let db: Database;
  let categoryId: string;
  let firstJobId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.app.get<Database>(DRIZZLE);

    const [category] = await db
      .insert(categories)
      .values({ name: 'Engineering', slug: 'engineering' })
      .returning();
    categoryId = category.id;

    const base = Date.now();
    const rows = Array.from({ length: 25 }, (_, index) => {
      const title = `Engineer ${index + 1}`;
      return {
        fingerprint: jobFingerprint(title, 'Acme', 'Nairobi'),
        sourceUrl: `https://example.com/jobs/${index + 1}`,
        applyUrl: `https://example.com/jobs/${index + 1}/apply`,
        title,
        company: 'Acme',
        location: index % 2 === 0 ? 'Nairobi, Kenya' : 'Remote',
        city: index % 2 === 0 ? 'Nairobi' : 'Remote',
        country: 'Kenya',
        remote: index % 2 === 1,
        employmentType: 'full_time',
        descriptionHtml:
          index === 0
            ? '<p>Build <strong>TypeScript</strong> APIs.</p><script>alert(1)</script>'
            : `<p>General engineering role number ${index + 1}.</p>`,
        descriptionText:
          index === 0 ? 'Build TypeScript APIs.' : `General engineering role number ${index + 1}.`,
        skills: index === 0 ? ['TypeScript'] : [],
        categoryId: index < 5 ? category.id : null,
        postedAt: new Date(base - index * 60_000),
        lastSeenAt: new Date(base),
        crawledAt: new Date(base),
      };
    });

    const inserted = await db.insert(jobs).values(rows).returning({ id: jobs.id });
    firstJobId = inserted[0].id;
  }, 120_000);

  afterAll(async () => {
    await closeTestApp(ctx);
  });

  it('renders the job list with filters and facets', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/jobs');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Engineer 1');
    expect(res.text).toContain('Engineering');
    expect(res.text).toContain('Load more');
  });

  it('filters with full-text search via websearch_to_tsquery', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/jobs').query({ q: 'typescript' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Engineer 1');
    expect(res.text).not.toContain('Engineer 2');
  });

  it('returns an HTMX partial when HX-Request is present', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/jobs').set('HX-Request', 'true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="job-list"');
    expect(res.text).not.toContain('<html');
  });

  it('appends the next cursor page with an out-of-band load-more control', async () => {
    const first = await request(ctx.app.getHttpServer()).get('/jobs').set('HX-Request', 'true');
    const match = first.text.match(/hx-get="([^"]*cursor=[^"]+)"/);
    expect(match).not.toBeNull();

    const nextUrl = match![1].replace(/&amp;/g, '&');
    const next = await request(ctx.app.getHttpServer()).get(nextUrl).set('HX-Request', 'true');
    expect(next.status).toBe(200);
    expect(next.text).toContain('hx-swap-oob="true"');
    expect(next.text).not.toContain('id="job-list"');
    expect((next.text.match(/href="\/jobs\//g) ?? []).length).toBe(5);
  });

  it('filters remote jobs', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/jobs').query({ remote: 'true' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Engineer 2');
    expect(res.text).not.toContain('Engineer 1</a>');
  });

  it('renders a job detail page with sanitized HTML and JobPosting JSON-LD', async () => {
    const res = await request(ctx.app.getHttpServer()).get(`/jobs/${firstJobId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<strong>TypeScript</strong>');
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('application/ld+json');
    expect(res.text).toContain('"@type":"JobPosting"');
    expect(res.text).toContain('name="description"');
  });

  it('returns 404 for a non-existent job', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/jobs/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
  });

  it('redirects unauthenticated admin requests to login', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/admin/sources');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
  });
});
