import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Database } from '../src/db/db.provider';
import {
  AdapterHttpError} from '../src/modules/crawler/adapters/errors';
import {
  AdapterNetworkError,
  ResponseTooLargeError,
  RobotsBlockedError,
  SourceKillSwitchError,
} from '../src/modules/crawler/adapters/errors';
import { CrawlerHttp, retryAfterMs } from '../src/modules/crawler/http';
import { CrawlerHttpOptions} from '../src/modules/crawler/http';

const server = setupServer();

function memoryRedis(): Redis {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key) ?? null,
    set: async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    },
  } as unknown as Redis;
}

function makeHttp(options: CrawlerHttpOptions = {}, db?: Database): { client: CrawlerHttp; redis: Redis } {
  const redis = memoryRedis();
  const config = { get: () => undefined } as unknown as ConfigService;
  const client = new CrawlerHttp(
    config,
    redis,
    { requestsPerSecond: 1_000, respectRobots: false, maxAttempts: 1, ...options },
    db,
  );
  return { client, redis };
}

describe('CrawlerHttp', () => {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('fetches a 200 with an identifying User-Agent', async () => {
    let userAgent: string | null = null;
    server.use(
      http.get('https://http.example/jobs', ({ request }) => {
        userAgent = request.headers.get('user-agent');
        return HttpResponse.text('ok');
      }),
    );
    const { client } = makeHttp();
    const response = await client.get('https://http.example/jobs');
    expect(response?.status).toBe(200);
    expect(response?.body).toBe('ok');
    expect(userAgent).toContain('JobCopilotBot/0.1');
    expect(userAgent).toContain('crawler@job-copilot.local');
  });

  it('sends validators and serves a cached body on 304', async () => {
    let calls = 0;
    let validator: string | null = null;
    server.use(
      http.get('https://http.example/conditional', ({ request }) => {
        calls += 1;
        validator = request.headers.get('if-none-match');
        if (calls === 1) return HttpResponse.text('cached body', { headers: { etag: '"v1"' } });
        return new HttpResponse(null, { status: 304 });
      }),
    );
    const { client } = makeHttp();
    await client.getOrThrow('https://http.example/conditional');
    const second = await client.get('https://http.example/conditional');
    expect(calls).toBe(2);
    expect(validator).toBe('"v1"');
    expect(second?.notModified).toBe(true);
    expect(second?.body).toBe('cached body');
  });

  it('retries 429 with jitter/backoff and respects Retry-After', async () => {
    let calls = 0;
    const delays: number[] = [];
    server.use(
      http.get('https://http.example/rate-limit', () => {
        calls += 1;
        return calls === 1
          ? new HttpResponse('slow down', { status: 429, headers: { 'retry-after': '120' } })
          : HttpResponse.text('recovered');
      }),
    );
    const { client } = makeHttp({
      maxAttempts: 2,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
    });
    await expect(client.getOrThrow('https://http.example/rate-limit')).resolves.toBe('recovered');
    expect(calls).toBe(2);
    expect(delays).toEqual([120_000]);
    expect(retryAfterMs('2', 1_000)).toBe(2_000);
    expect(retryAfterMs(new Date(61_000).toUTCString(), 1_000)).toBe(60_000);
  });

  it('does not retry 403 and returns a typed status error', async () => {
    let calls = 0;
    server.use(
      http.get('https://http.example/forbidden', () => {
        calls += 1;
        return new HttpResponse('no', { status: 403 });
      }),
    );
    const { client } = makeHttp({ maxAttempts: 3 });
    await expect(client.getOrThrow('https://http.example/forbidden')).rejects.toMatchObject({
      status: 403,
      code: 'blocked',
    } satisfies Partial<AdapterHttpError>);
    expect(calls).toBe(1);
  });

  it('times out slow responses with a typed network error', async () => {
    server.use(
      http.get('https://http.example/timeout', async () => {
        await delay(100);
        return HttpResponse.text('late');
      }),
    );
    const { client } = makeHttp({ timeoutMs: 20 });
    await expect(client.get('https://http.example/timeout')).rejects.toBeInstanceOf(AdapterNetworkError);
  });

  it('enforces the response cap even when content-length is absent', async () => {
    server.use(
      http.get('https://http.example/large', () =>
        new HttpResponse(new Uint8Array(128), { headers: { 'content-type': 'application/octet-stream' } }),
      ),
    );
    const { client } = makeHttp({ maxResponseBytes: 16 });
    await expect(client.get('https://http.example/large')).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it('checks and caches robots.txt and never requests a disallowed path', async () => {
    let robotsCalls = 0;
    let jobCalls = 0;
    server.use(
      http.get('https://robots.example/robots.txt', () => {
        robotsCalls += 1;
        return HttpResponse.text('User-agent: *\nDisallow: /private');
      }),
      http.get('https://robots.example/private/jobs', () => {
        jobCalls += 1;
        return HttpResponse.text('must not be fetched');
      }),
    );
    const { client } = makeHttp({ respectRobots: true });
    await expect(client.get('https://robots.example/private/jobs')).resolves.toBeNull();
    await expect(client.get('https://robots.example/private/jobs')).resolves.toBeNull();
    expect(robotsCalls).toBe(1);
    expect(jobCalls).toBe(0);
  });

  it('checks robots again before following a redirect', async () => {
    let targetCalls = 0;
    server.use(
      http.get('https://redirect.example/robots.txt', () => HttpResponse.text('User-agent: *\nAllow: /')),
      http.get('https://redirect.example/start', () =>
        new HttpResponse(null, { status: 302, headers: { location: 'https://target.example/private' } }),
      ),
      http.get('https://target.example/robots.txt', () => HttpResponse.text('User-agent: *\nDisallow: /private')),
      http.get('https://target.example/private', () => {
        targetCalls += 1;
        return HttpResponse.text('must not be fetched');
      }),
    );
    const { client } = makeHttp({ respectRobots: true });
    await expect(client.get('https://redirect.example/start')).rejects.toBeInstanceOf(RobotsBlockedError);
    expect(targetCalls).toBe(0);
  });

  it('checks the source kill switch before any traffic', async () => {
    const findFirst = vi.fn().mockResolvedValue({ killSwitch: true });
    const db = { query: { sources: { findFirst } } } as unknown as Database;
    let calls = 0;
    server.use(
      http.get('https://http.example/kill-switch', () => {
        calls += 1;
        return HttpResponse.text('no');
      }),
    );
    const { client } = makeHttp({}, db);
    await expect(client.get('https://http.example/kill-switch', { sourceId: 'source-1' })).rejects.toBeInstanceOf(
      SourceKillSwitchError,
    );
    expect(calls).toBe(0);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
