import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Bottleneck from 'bottleneck';
import robotsParser from 'robots-parser';
import { Agent } from 'undici';
import Redis from 'ioredis';
import { CRAWLER_REDIS } from './crawler.constants';

export interface CrawlRequestOptions {
  /** Prior ETag for a conditional request. */
  etag?: string;
  /** Prior Last-Modified value for a conditional request. */
  lastModified?: string;
  accept?: string;
  /** Override the client-wide robots setting for this URL. */
  respectRobots?: boolean;
}

export interface CrawlResponse {
  url: string;
  status: number;
  notModified: boolean;
  body: string;
  etag?: string;
  lastModified?: string;
}

interface CrawlerHttpOptions {
  userAgent?: string;
  requestsPerSecond?: number;
  respectRobots?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
}

const ROBOTS_CACHE_SECONDS = 24 * 60 * 60;
const CONDITIONAL_CACHE_SECONDS = 7 * 24 * 60 * 60;
const BACKOFF_MS = [1_000, 3_000, 8_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function originOf(url: string): string {
  const parsed = new URL(url);
  return parsed.origin;
}

/**
 * Polite HTTP client shared by every source adapter.
 *
 * - one Bottleneck queue per origin (1 req/s by default)
 * - robots.txt respected and cached in Redis for 24h
 * - conditional requests via ETag / If-Modified-Since
 * - exponential backoff retries for 429/5xx/network failures
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

  constructor(
    config: ConfigService,
    @Inject(CRAWLER_REDIS) private readonly redis: Redis,
    @Optional() options: CrawlerHttpOptions = {},
  ) {
    const contactEmail = config.get<string>('CRAWLER_CONTACT_EMAIL') ?? 'crawler@job-copilot.local';
    this.userAgent = options.userAgent ?? config.get<string>('CRAWLER_USER_AGENT') ?? `JobCopilotBot/0.1 (+${contactEmail})`;
    this.requestsPerSecond = options.requestsPerSecond ?? config.get<number>('CRAWLER_REQUESTS_PER_SECOND') ?? 1;
    this.respectRobots = options.respectRobots ?? config.get<boolean>('CRAWLER_RESPECT_ROBOTS') ?? true;
    this.timeoutMs = options.timeoutMs ?? config.get<number>('CRAWLER_TIMEOUT_MS') ?? 20_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  /**
   * Fetch a URL. Returns `null` when robots.txt disallows it (the skip is
   * logged), and `notModified: true` for a 304 response.
   */
  async get(url: string, options: CrawlRequestOptions = {}): Promise<CrawlResponse | null> {
    if (options.respectRobots !== false && this.respectRobots) {
      const allowed = await this.isAllowed(url);
      if (!allowed) {
        this.logger.warn(`Skipping ${url}: disallowed by robots.txt`);
        return null;
      }
    }

    const cached = await this.readConditional(url);
    const etag = options.etag ?? cached?.etag;
    const lastModified = options.lastModified ?? cached?.lastModified;

    const headers: Record<string, string> = {
      'user-agent': this.userAgent,
      accept: options.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5',
    };
    if (etag) headers['if-none-match'] = etag;
    if (lastModified) headers['if-modified-since'] = lastModified;

    let response = await this.schedule(originOf(url), () => this.fetchWithRetry(url, headers));

    if (response.status === 304) {
      // Serve the cached body so adapters can re-parse it. If we only have
      // validators (older cache entry), retry once without them.
      if (cached?.body !== undefined) {
        return {
          url,
          status: 304,
          notModified: true,
          body: cached.body,
          etag,
          lastModified,
        };
      }
      delete headers['if-none-match'];
      delete headers['if-modified-since'];
      response = await this.schedule(originOf(url), () => this.fetchWithRetry(url, headers));
    }

    const body = await response.text();
    const responseEtag = response.headers.get('etag') ?? undefined;
    const responseLastModified = response.headers.get('last-modified') ?? undefined;
    await this.writeConditional(url, responseEtag, responseLastModified, body);

    return {
      url,
      status: response.status,
      notModified: false,
      body,
      etag: responseEtag,
      lastModified: responseLastModified,
    };
  }

  /** Fetch a URL and throw on non-2xx responses (304 cache hits are OK). */
  async getOrThrow(url: string, options: CrawlRequestOptions = {}): Promise<string> {
    const response = await this.get(url, options);
    if (!response) {
      throw new Error(`Refused to fetch ${url}: disallowed by robots.txt`);
    }
    if (!response.notModified && (response.status < 200 || response.status >= 300)) {
      throw new Error(`Request to ${url} failed with HTTP ${response.status}`);
    }
    return response.body;
  }

  private limiterFor(origin: string): Bottleneck {
    let limiter = this.limiters.get(origin);
    if (!limiter) {
      limiter = new Bottleneck({
        minTime: Math.max(0, Math.round(1000 / Math.max(this.requestsPerSecond, 0.1))),
        maxConcurrent: 1,
      });
      this.limiters.set(origin, limiter);
    }
    return limiter;
  }

  private schedule<T>(origin: string, task: () => Promise<T>): Promise<T> {
    return this.limiterFor(origin).schedule(task) as Promise<T>;
  }

  private async fetchWithRetry(url: string, headers: Record<string, string>): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(this.timeoutMs),
          dispatcher: this.agent,
        } as unknown as RequestInit);

        if (response.status === 429 || response.status >= 500) {
          if (attempt === this.maxAttempts - 1) {
            return response;
          }
          const retryAfter = Number(response.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : BACKOFF_MS[attempt] ?? 8_000;
          this.logger.warn(`HTTP ${response.status} from ${url}; retrying in ${delay}ms`);
          await sleep(delay);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts - 1) {
          break;
        }
        const delay = BACKOFF_MS[attempt] ?? 8_000;
        this.logger.warn(`Request to ${url} failed (${(error as Error).message}); retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Request to ${url} failed`);
  }

  private async isAllowed(url: string): Promise<boolean> {
    const origin = originOf(url);
    const robots = await this.loadRobots(origin);
    if (!robots) {
      return true;
    }
    const allowed = robots.isAllowed(url, this.userAgent);
    return allowed !== false;
  }

  private async loadRobots(origin: string) {
    const robotsUrl = `${origin}/robots.txt`;
    const cacheKey = `crawler:robots:${origin}`;

    try {
      const cached = await this.redis.get(cacheKey);
      if (cached !== null) {
        return cached ? robotsParser(robotsUrl, cached) : null;
      }
    } catch (error) {
      this.logger.debug(`Robots cache read failed for ${origin}: ${(error as Error).message}`);
    }

    let content = '';
    try {
      const response = await this.schedule(origin, () => this.fetchWithRetry(robotsUrl, { 'user-agent': this.userAgent }));
      if (response.ok) {
        content = await response.text();
      }
    } catch (error) {
      this.logger.warn(`Could not fetch ${robotsUrl}: ${(error as Error).message}; assuming crawling is allowed`);
      return null;
    }

    try {
      await this.redis.set(cacheKey, content, 'EX', ROBOTS_CACHE_SECONDS);
    } catch (error) {
      this.logger.debug(`Robots cache write failed for ${origin}: ${(error as Error).message}`);
    }

    return content ? robotsParser(robotsUrl, content) : null;
  }

  private async readConditional(
    url: string,
  ): Promise<{ etag?: string; lastModified?: string; body?: string } | null> {
    try {
      const raw = await this.redis.get(`crawler:http:${url}`);
      return raw ? (JSON.parse(raw) as { etag?: string; lastModified?: string; body?: string }) : null;
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
    if (!etag && !lastModified) {
      return;
    }
    try {
      await this.redis.set(
        `crawler:http:${url}`,
        JSON.stringify({ etag, lastModified, body }),
        'EX',
        CONDITIONAL_CACHE_SECONDS,
      );
    } catch {
      // Cache misses only cost an extra request; never fail the crawl.
    }
  }
}
