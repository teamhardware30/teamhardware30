import { Injectable, Logger } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { CrawlerHttp } from '../http';
import { JobDto, RawJob } from '../dto/job.dto';
import { escapeHtml, htmlToText, looksRemote, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { SourceAdapter, absoluteUrl, asNumber, asString, parseSalary } from './source-adapter.interface';
import { load } from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';

interface HtmlConfig {
  listingUrl: string;
  itemSelector: string;
  fields?: Record<string, string>;
  detailDescriptionSelector?: string;
  paginationSelector?: string;
  maxPages?: number;
}

const DEFAULT_FIELDS: Record<string, string> = {
  title: 'h2, h3',
  url: 'a@href',
  company: '.company',
  location: '.location',
  description: '.description',
  postedAt: 'time@datetime',
};

@Injectable()
export class HtmlAdapter implements SourceAdapter {
  readonly kind = 'html' as const;
  private readonly logger = new Logger(HtmlAdapter.name);

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawJob> {
    const config = source.config as unknown as HtmlConfig;
    if (!config.listingUrl || !config.itemSelector) {
      throw new Error(`HTML source ${source.name} needs config.listingUrl and config.itemSelector`);
    }

    const maxPages = asNumber(config.maxPages) ?? 3;
    const fields = { ...DEFAULT_FIELDS, ...(config.fields ?? {}) };
    const visited = new Set<string>();
    let pageUrl: string | undefined = config.listingUrl;
    let page = 0;

    while (pageUrl && page < maxPages && !visited.has(pageUrl)) {
      visited.add(pageUrl);
      const html = await this.http.getOrThrow(pageUrl);
      const $ = load(html);

      const items = $(config.itemSelector);
      for (let index = 0; index < items.length; index += 1) {
        const element = items.eq(index);
        const raw: RawJob = {
          __sourceName: source.name,
          __baseUrl: pageUrl,
        };

        for (const [key, selector] of Object.entries(fields)) {
          const value = pick($, element, selector);
          if (value) {
            raw[key] = value;
          }
        }

        const detailUrl = absoluteUrl(asString(raw.url), pageUrl);
        if (detailUrl) {
          raw.__detailUrl = detailUrl;
          raw.url = detailUrl;
          if (config.detailDescriptionSelector && !raw.description) {
            try {
              const detailHtml = await this.http.getOrThrow(detailUrl);
              const detail$ = load(detailHtml);
              const description = detail$(config.detailDescriptionSelector).first().html();
              if (description) {
                raw.description = description.trim();
              }
            } catch (error) {
              this.logger.warn(`Could not fetch HTML detail page ${detailUrl}: ${(error as Error).message}`);
            }
          }
        }

        yield raw;
      }

      pageUrl = config.paginationSelector
        ? absoluteUrl(pick($, $.root(), config.paginationSelector), pageUrl)
        : undefined;
      page += 1;
    }
  }

  normalize(raw: RawJob): JobDto {
    const title = asString(raw.title) ?? 'Untitled role';
    const location = asString(raw.location);
    const split = splitLocation(location ?? asString(raw.city));
    const description = asString(raw.description);
    const descriptionHtml = description
      ? /<[a-z][\s\S]*>/i.test(description)
        ? description
        : `<p>${escapeHtml(description)}</p>`
      : '<p></p>';
    const remoteValue = asString(raw.remote)?.toLowerCase();
    const salary = parseSalary(asString(raw.salary));

    return {
      externalId: asString(raw.externalId),
      sourceUrl: asString(raw.url) ?? asString(raw.__detailUrl) ?? asString(raw.__baseUrl) ?? '',
      applyUrl: asString(raw.applyUrl) ?? asString(raw.url) ?? asString(raw.__detailUrl),
      title,
      company: asString(raw.company) ?? asString(raw.__sourceName) ?? 'Unknown company',
      location,
      city: asString(raw.city) ?? split.city,
      country: asString(raw.country) ?? split.country,
      remote:
        remoteValue === 'true' ||
        remoteValue === 'yes' ||
        remoteValue === '1' ||
        looksRemote(location, title),
      employmentType: normalizeEmploymentType(asString(raw.employmentType)),
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      skills: asString(raw.skills)
        ?.split(',')
        .map((skill) => skill.trim())
        .filter(Boolean) ?? [],
      ...salary,
      applyMethod: 'external_ats',
      postedAt: parseDate(asString(raw.postedAt)),
    };
  }
}

function pick($: CheerioAPI, element: Cheerio<any>, selector: string): string | undefined {
  if (!selector) {
    return undefined;
  }
  const [rawSelector, attribute] = selector.split('@');
  const target = rawSelector === 'self' || rawSelector === '' ? element : element.find(rawSelector).first();
  if (!target.length) {
    return undefined;
  }
  if (attribute) {
    return target.attr(attribute)?.trim();
  }
  return target.text().trim() || undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
