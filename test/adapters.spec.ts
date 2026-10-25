import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Source } from '../src/db/schema';
import { ArbeitnowAdapter } from '../src/modules/crawler/adapters/arbeitnow.adapter';
import { AshbyAdapter } from '../src/modules/crawler/adapters/ashby.adapter';
import { AdapterSchemaError } from '../src/modules/crawler/adapters/errors';
import { GreenhouseAdapter } from '../src/modules/crawler/adapters/greenhouse.adapter';
import { HtmlAdapter } from '../src/modules/crawler/adapters/html.adapter';
import { JsonLdAdapter } from '../src/modules/crawler/adapters/jsonld.adapter';
import { LeverAdapter } from '../src/modules/crawler/adapters/lever.adapter';
import { RemotiveAdapter } from '../src/modules/crawler/adapters/remotive.adapter';
import { SourceAdapter } from '../src/modules/crawler/adapters/source-adapter.interface';
import { RawJob} from '../src/modules/crawler/dto/job.dto';
import { normalizeJobDto, rawItem } from '../src/modules/crawler/dto/job.dto';
import { CrawlerHttp } from '../src/modules/crawler/http';

const fixtures = join(process.cwd(), 'test', 'fixtures', 'adapters');
const read = (name: string) => readFileSync(join(fixtures, name), 'utf8');

const server = setupServer(
  http.get('https://boards-api.greenhouse.io/v1/boards/acme/jobs', () =>
    HttpResponse.json(JSON.parse(read('greenhouse.json'))),
  ),
  http.get('https://api.lever.co/v0/postings/acme', () => HttpResponse.json(JSON.parse(read('lever.json')))),
  http.get('https://api.ashbyhq.com/posting-api/job-board/acme', () =>
    HttpResponse.json(JSON.parse(read('ashby.json'))),
  ),
  http.get('https://remotive.com/api/remote-jobs', () => HttpResponse.json(JSON.parse(read('remotive.json')))),
  http.get('https://www.arbeitnow.com/api/job-board-api', () =>
    HttpResponse.json(JSON.parse(read('arbeitnow.json'))),
  ),
  http.get('https://jobs.example.com/sitemap.xml', () =>
    new HttpResponse(read('jsonld-sitemap.xml'), { headers: { 'content-type': 'application/xml' } }),
  ),
  http.get('https://jobs.example.com/jobs/1', () => HttpResponse.html(read('jsonld-detail.html'))),
  http.get('https://example.com/careers', () => HttpResponse.html(read('html-listing.html'))),
  http.get('https://example.com/careers/1', () => HttpResponse.html(read('html-detail.html'))),
  http.get('https://example.com/careers/2', () => HttpResponse.html(read('html-detail.html'))),
);

function makeSource(kind: Source['kind'], baseUrl: string, config: Record<string, unknown>): Source {
  return {
    id: `source-${kind}`,
    name: `Test ${kind}`,
    kind,
    baseUrl,
    config,
    cron: '0 * * * *',
    enabled: true,
    killSwitch: false,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeHttp(): CrawlerHttp {
  const config = { get: () => undefined } as unknown as ConfigService;
  const redis = {
    get: async () => null,
    set: async () => 'OK',
  } as unknown as Redis;
  return new CrawlerHttp(config, redis, { respectRobots: false });
}

async function collect(adapter: SourceAdapter, source: Source): Promise<RawJob[]> {
  const rows: RawJob[] = [];
  for await (const raw of adapter.fetch(source)) {
    rows.push(raw);
  }
  return rows;
}

describe('source adapters', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('normalizes Greenhouse board jobs', async () => {
    const adapter = new GreenhouseAdapter(makeHttp());
    const source = makeSource('greenhouse', 'https://boards.greenhouse.io/acme', {
      companies: [{ token: 'acme', name: 'Acme' }],
    });

    const rows = await collect(adapter, source);
    expect(rows).toHaveLength(1);

    const job = adapter.normalize(rows[0]);
    expect(job.title).toBe('Senior Backend Engineer');
    expect(job.company).toBe('Acme');
    expect(job.location).toBe('Nairobi, Kenya');
    expect(job.remote).toBe(false);
    expect(job.skills).toContain('TypeScript');
    expect(job.applyMethod).toBe('external_ats');
  });

  it('normalizes Lever postings', async () => {
    const adapter = new LeverAdapter(makeHttp());
    const source = makeSource('lever', 'https://jobs.lever.co/acme', {
      companies: [{ token: 'acme', name: 'Acme' }],
    });

    const rows = await collect(adapter, source);
    const job = adapter.normalize(rows[0]);
    expect(job.title).toBe('Platform Engineer');
    expect(job.employmentType).toBe('full_time');
    expect(job.remote).toBe(true);
    expect(job.descriptionText).toContain('Node.js');
  });

  it('normalizes Ashby postings', async () => {
    const adapter = new AshbyAdapter(makeHttp());
    const source = makeSource('ashby', 'https://jobs.ashbyhq.com/acme', {
      companies: [{ token: 'acme', name: 'Acme' }],
    });

    const rows = await collect(adapter, source);
    const job = adapter.normalize(rows[0]);
    expect(job.title).toBe('Frontend Engineer');
    expect(job.city).toBe('Berlin');
    expect(job.country).toBe('Germany');
    expect(job.employmentType).toBe('full_time');
  });

  it('normalizes Remotive feed jobs and salary', async () => {
    const adapter = new RemotiveAdapter(makeHttp());
    const source = makeSource('remotive', 'https://remotive.com', { limit: 100 });

    const rows = await collect(adapter, source);
    const job = adapter.normalize(rows[0]);
    expect(job.remote).toBe(true);
    expect(job.salaryMin).toBe(90_000);
    expect(job.salaryMax).toBe(120_000);
    expect(job.salaryCurrency).toBe('USD');
    expect(job.category).toBe('Software Development');
  });

  it('normalizes Arbeitnow jobs and unix timestamps', async () => {
    const adapter = new ArbeitnowAdapter(makeHttp());
    const source = makeSource('arbeitnow', 'https://www.arbeitnow.com', { maxPages: 1 });

    const rows = await collect(adapter, source);
    const job = adapter.normalize(rows[0]);
    expect(job.city).toBe('Berlin');
    expect(job.country).toBe('Germany');
    expect(job.remote).toBe(false);
    expect(job.postedAt?.toISOString()).toBe('2025-10-09T08:53:20.000Z');
  });

  it('crawls a sitemap and normalizes schema.org JobPosting', async () => {
    const adapter = new JsonLdAdapter(makeHttp());
    const source = makeSource('jsonld', 'https://jobs.example.com', {
      sitemapUrl: 'https://jobs.example.com/sitemap.xml',
      urlPattern: '/jobs/',
    });

    const rows = await collect(adapter, source);
    expect(rows).toHaveLength(1);

    const job = adapter.normalize(rows[0]);
    expect(job.title).toBe('Data Engineer');
    expect(job.company).toBe('DataCorp');
    expect(job.city).toBe('Cape Town');
    expect(job.country).toBe('ZA');
    expect(job.employmentType).toBe('full_time');
    expect(job.salaryMin).toBe(80_000);
    expect(job.salaryMax).toBe(100_000);
    expect(job.salaryCurrency).toBe('USD');
    expect(job.applyMethod).toBe('external_ats');
  });

  it('crawls an HTML listing with CSS selectors and detail descriptions', async () => {
    const adapter = new HtmlAdapter(makeHttp());
    const source = makeSource('html', 'https://example.com', {
      listingUrl: 'https://example.com/careers',
      itemSelector: '.job-card',
      fields: {
        title: 'h2 a',
        url: 'h2 a@href',
        company: '.company',
        location: '.location',
        postedAt: 'time@datetime',
      },
      detailDescriptionSelector: '.job-description',
      maxPages: 1,
    });

    const rows = await collect(adapter, source);
    expect(rows).toHaveLength(2);

    const job = adapter.normalize(rows[0]);
    expect(job.title).toBe('Support Engineer');
    expect(job.company).toBe('HelpCo');
    expect(job.remote).toBe(true);
    expect(job.descriptionText).toContain('Zendesk');
    expect(job.sourceUrl).toBe('https://example.com/careers/1');
  });

  it('rejects malformed items at every adapter boundary', () => {
    const malformed = JSON.parse(read('malformed.json')) as Record<string, Record<string, unknown>>;
    const cases: Array<[string, SourceAdapter, Record<string, unknown>]> = [
      ['greenhouse', new GreenhouseAdapter(makeHttp()), malformed.greenhouse],
      ['lever', new LeverAdapter(makeHttp()), malformed.lever],
      ['ashby', new AshbyAdapter(makeHttp()), malformed.ashby],
      ['remotive', new RemotiveAdapter(makeHttp()), malformed.remotive],
      ['arbeitnow', new ArbeitnowAdapter(makeHttp()), malformed.arbeitnow],
      ['jsonld', new JsonLdAdapter(makeHttp()), malformed.jsonld],
      ['html', new HtmlAdapter(makeHttp()), malformed.html],
    ];

    for (const [kind, adapter, payload] of cases) {
      const raw = rawItem(payload, {
        sourceUrl: 'https://jobs.example.com/jobs/1',
        baseUrl: 'https://jobs.example.com',
        company: kind === 'html' ? 'HelpCo' : undefined,
      });
      expect(() => adapter.normalize(raw), kind).toThrow(AdapterSchemaError);
    }
  });

  it('validates scalar edges, sanitizes HTML, resolves relative URLs, and never marks external JSON-LD onsite', () => {
    const adapter = new JsonLdAdapter(makeHttp());
    const job = adapter.normalize(
      rawItem(
        {
          '@type': 'JobPosting',
          title: 'Platform &amp; API Engineer',
          hiringOrganization: { name: 'Acme' },
          description: '<p>Build APIs</p><script>alert(1)</script>',
          url: '/jobs/1?utm_source=newsletter',
          directApply: true,
          datePosted: '2026-10-01',
          baseSalary: { currency: 'usd', value: { minValue: '50,000', unitText: 'YEAR' } },
        },
        { sourceUrl: 'https://jobs.example.com/jobs/1', baseUrl: 'https://jobs.example.com' },
      ),
    );

    expect(job.sourceUrl).toBe('https://jobs.example.com/jobs/1');
    expect(job.descriptionHtml).toBe('<p>Build APIs</p>');
    expect(job.salaryMin).toBe(50_000);
    expect(job.salaryCurrency).toBe('USD');
    expect(job.applyMethod).toBe('external_ats');
    expect(normalizeJobDto({ ...job, salaryMax: '' }).salaryMax).toBeUndefined();
    expect(() => normalizeJobDto({ ...job, sourceUrl: '/relative' })).toThrow(AdapterSchemaError);
  });
});
