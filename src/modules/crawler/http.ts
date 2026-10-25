import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Bottleneck from 'bottleneck';
import { eq } from 'drizzle-orm';
import type Redis from 'ioredis';
import robotsParser from 'robots-parser';
import { Agent } from 'undici';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { sources } from '../../db/schema';
import {
  AdapterHttpError,
  AdapterNetworkError,
  ResponseTooLargeError,
  RobotsBlockedError,
  SourceKillSwitchError,
} from './adapters/errors';
import { CRAWLER_REDIS } from './crawler.constants';

export interface CrawlRequestOptions {
  etag?: string;
  lastModified?: string;
  accept?: string;
  respectRobots?: boolean;
  /** Enables the database-backed kill switch and source-specific limiter. */
  sourceId?: string;
  requestsPerSecond?: number;
}

export interface CrawlResponse {
  url: string;
  status: number;
  notModified: boolean;
  body: string;
  etag?: string;
  lastModified?: string;
}

export interface CrawlerHttpOptions {
  userAgent?: string;
  requestsPerSecond?: number;
  respectRobots?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
  retryBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

interface ConditionalCacheEntry {
  etag?: string;
  lastModified?: string;
  body?: string;
}

const ROBOTS_CACHE_SECONDS = 24 * 60 * 60;
const CONDITIONAL_CACHE_SECONDS = 7 * 24 * 60 * 60;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function originOf(url: string): string {
  return new URL(url).origin;
}

function assertHttpUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AdapterNetworkError(url);
  }
}

/** Parse both delta-seconds and HTTP-date Retry-After values. */
export function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds >= 0 ? Math.round(seconds * 1000) : null;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * Polite HTTP client shared by every source adapter. Each actual request (including
 * retries, robots and redirects) passes through source kill-switch, robots and
 * per-origin/source limiters.
 */
@Injectable()
export class CrawlerHttp {
  private readonly logger = new Logger(CrawlerHttp.name);
  private readonly agent = new Agent({ keepAliveTimeout: 10_000, keepAliveMaxTimeout: 30_000 });
  private readonly limiters = new Map<string, Bottleneck>();
  private readonly userAgent: string;
  private readonly requestsPerSecond: number;
  private readonly respectRobots: boolean;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly maxResponseBytes: number;
  private readonly retryBaseMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    config: ConfigService,
    @Inject(CRAWLER_REDIS) private readonly redis: Redis,
    @Optional() options: CrawlerHttpOptions = {},
    @Optional() @Inject(DRIZZLE) private readonly db?: Database,
  ) {
    const contactEmail = config.get<string>('CRAWLER_CONTACT_EMAIL') ?? 'crawler@job-copilot.local';
    this.userAgent =
      options.userAgent ?? config.get<string>('CRAWLER_USER_AGENT') ?? `JobCopilotBot/0.1 (+${contactEmail})`;
    this.requestsPerSecond = options.requestsPerSecond ?? config.get<number>('CRAWLER_REQUESTS_PER_SECOND') ?? 1;
    this.respectRobots = options.respectRobots ?? config.get<boolean>('CRAWLER_RESPECT_ROBOTS') ?? true;
    this.timeoutMs = options.timeoutMs ?? config.get<number>('CRAWLER_TIMEOUT_MS') ?? 30_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.maxResponseBytes =
      options.maxResponseBytes ?? config.get<number>('CRAWLER_MAX_RESPONSE_BYTES') ?? 5 * 1024 * 1024;
    this.retryBaseMs = Math.max(1, options.retryBaseMs ?? 1_000);
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  /** Returns null for a robots-disallowed initial URL; a 304 includes the cached body. */
  async get(url: string, options: CrawlRequestOptions = {}): Promise<CrawlResponse | null> {
    assertHttpUrl(url);
    await this.assertSourceAllowed(options.sourceId, url);
    if (!(await this.checkRobots(url, options))) {
      this.logger.warn(`Skipping ${url}: disallowed by robots.txt`);
      return null;
    }

    const cached = await this.readConditional(url);
    const etag = options.etag ?? cached?.etag;
    const lastModified = options.lastModified ?? cached?.lastModified;
    const headers = this.headers(options, etag, lastModified);

    let response = await this.fetchFollowingRedirects(url, headers, options, 'GET');
    if (response.status === 304) {
      if (cached?.body !== undefined) {
        return {
          url: response.url || url,
          status: 304,
          notModified: true,
          body: cached.body,
          etag,
          lastModified,
        };
      }
      response = await this.fetchFollowingRedirects(url, this.headers(options), options, 'GET');
    }

    const body = await this.readBody(response, this.maxResponseBytes);
    const responseEtag = response.headers.get('etag') ?? undefined;
    const responseLastModified = response.headers.get('last-modified') ?? undefined;
    if (response.status >= 200 && response.status < 300) {
      await this.writeConditional(url, responseEtag, responseLastModified, body);
    }

    return {
      url: response.url || url,
      status: response.status,
      notModified: false,
      body,
      etag: responseEtag,
      lastModified: responseLastModified,
    };
  }

  async getOrThrow(url: string, options: CrawlRequestOptions = {}): Promise<string> {
    const response = await this.get(url, options);
    if (!response) throw new RobotsBlockedError(url);
    if (!response.notModified && (response.status < 200 || response.status >= 300)) {
      throw new AdapterHttpError(response.status, response.url || url);
    }
    return response.body;
  }

  /** A weekly freshness HEAD check. 404/410 are returned for the caller to deactivate. */
  async head(url: string, options: CrawlRequestOptions = {}): Promise<CrawlResponse | null> {
    assertHttpUrl(url);
    await this.assertSourceAllowed(options.sourceId, url);
    if (!(await this.checkRobots(url, options))) {
      this.logger.warn(`Skipping HEAD ${url}: disallowed by robots.txt`);
      return null;
    }
    const response = await this.fetchFollowingRedirects(url, this.headers(options), options, 'HEAD');
    void response.body?.cancel().catch(() => undefined);
    return {
      url: response.url || url,
      status: response.status,
      notModified: response.status === 304,
      body: '',
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
    };
  }

  private headers(options: CrawlRequestOptions, etag?: string, lastModified?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept:
        options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
    };
    if (etag) headers['if-none-match'] = etag;
    if (lastModified) headers['if-modified-since'] = lastModified;
    return headers;
  }

  private limiterFor(key: string, requestsPerSecond: number): Bottleneck {
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new Bottleneck({
        minTime: Math.max(0, Math.round(1000 / Math.max(requestsPerSecond, 0.1))),
        maxConcurrent: 1,
      });
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  private schedule<T>(url: string, options: CrawlRequestOptions, task: () => Promise<T>): Promise<T> {
    const domain = this.limiterFor(`domain:${originOf(url)}`, this.requestsPerSecond);
    const sourceRate = options.requestsPerSecond;
    if (options.sourceId && sourceRate) {
      const source = this.limiterFor(`source:${options.sourceId}`, sourceRate);
      return domain.schedule(() => source.schedule(task)) as Promise<T>;
    }
    return domain.schedule(task) as Promise<T>;
  }

  private async fetchFollowingRedirects(
    url: string,
    headers: Record<string, string>,
    options: CrawlRequestOptions,
    method: 'GET' | 'HEAD',
    checkRedirectRobots = true,
  ): Promise<Response> {
    let currentUrl = url;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await this.fetchWithRetry(currentUrl, headers, options, method, checkRedirectRobots);
      if (!REDIRECT_STATUSES.has(response.status)) return response;
      const location = response.headers.get('location');
      void response.body?.cancel().catch(() => undefined);
      if (!location || redirects === 5) {
        throw new AdapterNetworkError(currentUrl);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      assertHttpUrl(nextUrl);
      await this.assertSourceAllowed(options.sourceId, nextUrl);
      if (checkRedirectRobots && !(await this.checkRobots(nextUrl, options))) {
        throw new RobotsBlockedError(nextUrl);
      }
      currentUrl = nextUrl;
    }
    throw new AdapterNetworkError(url);
  }

  private async fetchWithRetry(
    url: string,
    headers: Record<string, string>,
    options: CrawlRequestOptions,
    method: 'GET' | 'HEAD',
    checkRedirectRobots: boolean,
  ): Promise<Response> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      await this.assertSourceAllowed(options.sourceId, url);
      let response: Response;
      try {
        response = await this.schedule(url, options, async () =>
          fetch(url, {
            method,
            headers,
            redirect: 'manual',
            signal: AbortSignal.timeout(this.timeoutMs),
            dispatcher: this.agent,
          } as unknown as RequestInit),
        );
      } catch (error) {
        // Timeouts and other network errors are surfaced, not retried as if they were HTTP 5xx.
        throw new AdapterNetworkError(url, { cause: error });
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === this.maxAttempts - 1) return response;
      void response.body?.cancel().catch(() => undefined);
      const retryAfter = retryAfterMs(response.headers.get('retry-after'));
      const exponential = this.retryBaseMs * 2 ** attempt;
      const delay = retryAfter ?? Math.round(exponential * (1 + this.random() * 0.25));
      this.logger.warn(`HTTP ${response.status} from ${url}; retrying in ${delay}ms`);
      await this.sleep(delay);

      if (checkRedirectRobots) {
        await this.assertSourceAllowed(options.sourceId, url);
      }
    }
    throw new AdapterNetworkError(url);
  }

  private async readBody(response: Response, maxBytes: number): Promise<string> {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      throw new ResponseTooLargeError(response.url, maxBytes);
    }
    if (!response.body) return '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          void reader.cancel().catch(() => undefined);
          throw new ResponseTooLargeError(response.url, maxBytes);
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      return body;
    } finally {
      reader.releaseLock();
    }
  }

  private async checkRobots(url: string, options: CrawlRequestOptions): Promise<boolean> {
    if (options.respectRobots === false || !this.respectRobots) return true;
    const robots = await this.loadRobots(originOf(url), options);
    return robots ? robots.isAllowed(url, this.userAgent) !== false : true;
  }

  private async loadRobots(origin: string, options: CrawlRequestOptions) {
    const robotsUrl = `${origin}/robots.txt`;
    const cacheKey = `crawler:robots:${origin}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) return cached ? robotsParser(robotsUrl, cached) : null;
    } catch (error) {
      this.logger.debug(`Robots cache read failed for ${origin}: ${(error as Error).message}`);
    }

    let content = '';
    try {
      const response = await this.fetchFollowingRedirects(
        robotsUrl,
        { 'user-agent': this.userAgent, accept: 'text/plain' },
        options,
        'GET',
        false,
      );
      if (response.ok) content = await this.readBody(response, Math.min(this.maxResponseBytes, 512 * 1024));
      else void response.body?.cancel().catch(() => undefined);
    } catch (error) {
      this.logger.warn(`Could not fetch ${robotsUrl}: ${(error as Error).message}; assuming crawling is allowed`);
    }

    try {
      await this.redis.set(cacheKey, content, 'EX', ROBOTS_CACHE_SECONDS);
    } catch (error) {
      this.logger.debug(`Robots cache write failed for ${origin}: ${(error as Error).message}`);
    }
    return content ? robotsParser(robotsUrl, content) : null;
  }

  private async assertSourceAllowed(sourceId: string | undefined, url: string): Promise<void> {
    if (!sourceId || !this.db) return;
    const source = await this.db.query.sources.findFirst({
      where: eq(sources.id, sourceId),
      columns: { killSwitch: true },
    });
    if (!source || source.killSwitch) throw new SourceKillSwitchError(sourceId, url);
  }

  private async readConditional(url: string): Promise<ConditionalCacheEntry | null> {
    try {
      const raw = await this.redis.get(`crawler:http:${url}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<ConditionalCacheEntry>;
      return {
        etag: typeof parsed.etag === 'string' ? parsed.etag : undefined,
        lastModified: typeof parsed.lastModified === 'string' ? parsed.lastModified : undefined,
        body: typeof parsed.body === 'string' ? parsed.body : undefined,
      };
    } catch {
      return null;
    }
  }

  private async writeConditional(
    url: string,
    etag: string | undefined,
    lastModified: string | undefined,
    body: string,
  ): Promise<void> {
    if (!etag && !lastModified) return;
    try {
      await this.redis.set(
        `crawler:http:${url}`,
        JSON.stringify({ etag, lastModified, body } satisfies ConditionalCacheEntry),
        'EX',
        CONDITIONAL_CACHE_SECONDS,
      );
    } catch {
      // Cache failures only cost another request; they must not fail a crawl.
    }
  }
}
