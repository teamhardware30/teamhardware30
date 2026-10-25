import { Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import { CheerioAPI } from 'cheerio';
import { Source } from '../../../db/schema';
import { escapeHtml, htmlToText, looksRemote, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { JobDto, RawItem} from '../dto/job.dto';
import { normalizeJobDto, rawItem } from '../dto/job.dto';
import { CrawlerHttp } from '../http';
import {
  SourceAdapter} from './source-adapter.interface';
import {
  absoluteUrl,
  asNumber,
  asString,
  parseSalary,
  sourceRequestOptions,
} from './source-adapter.interface';

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

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawItem> {
    const config = source.config as unknown as HtmlConfig;
    if (!config.listingUrl || !config.itemSelector) {
      throw new Error(`HTML source ${source.name} needs config.listingUrl and config.itemSelector`);
    }

    const maxPages = Math.min(Math.max(asNumber(config.maxPages) ?? 3, 1), 100);
    const fields = { ...DEFAULT_FIELDS, ...(config.fields ?? {}) };
    const visited = new Set<string>();
    let pageUrl: string | undefined = config.listingUrl;
    let page = 0;

    while (pageUrl && page < maxPages && !visited.has(pageUrl)) {
      visited.add(pageUrl);
      const html = await this.http.getOrThrow(pageUrl, sourceRequestOptions(source));
      const $ = load(html);
      const items = $(config.itemSelector);

      for (let index = 0; index < items.length; index += 1) {
        const element = items.eq(index);
        const payload: Record<string, unknown> = {};
        for (const [key, selector] of Object.entries(fields)) {
          const value = pick($, element, selector);
          if (value) payload[key] = value;
        }

        const warnings: string[] = [];
        const detailUrl = absoluteUrl(payload.url, pageUrl);
        if (detailUrl) {
          payload.url = detailUrl;
          if (config.detailDescriptionSelector && !payload.description) {
            try {
              const detailHtml = await this.http.getOrThrow(detailUrl, sourceRequestOptions(source));
              const detail$ = load(detailHtml);
              const description = detail$(config.detailDescriptionSelector).first().html();
              if (description) payload.description = description.trim();
            } catch (error) {
              warnings.push(`Could not fetch HTML detail page: ${(error as Error).message}`);
            }
          }
        }

        yield rawItem(payload, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: pageUrl,
          sourceUrl: detailUrl ?? pageUrl,
          company: source.name,
          warnings,
        });
      }

      pageUrl = config.paginationSelector
        ? absoluteUrl(pick($, $.root(), config.paginationSelector), pageUrl)
        : undefined;
      page += 1;
    }
  }

  normalize(raw: RawItem): JobDto {
    const payload = raw.payload;
    const title = asString(payload.title);
    const location = asString(payload.location);
    const split = splitLocation(location ?? asString(payload.city));
    const description = asString(payload.description);
    const descriptionHtml = description
      ? /<[a-z][\s\S]*>/i.test(description)
        ? description
        : `<p>${escapeHtml(description)}</p>`
      : '<p></p>';
    const remoteValue = asString(payload.remote)?.toLowerCase();
    const salary = parseSalary(asString(payload.salary));
    const baseUrl = raw.metadata.sourceUrl ?? raw.metadata.baseUrl ?? '';
    const sourceUrl = absoluteUrl(payload.url, baseUrl) ?? baseUrl;

    return normalizeJobDto(
      {
        externalId: asString(payload.externalId),
        sourceUrl,
        applyUrl: absoluteUrl(payload.applyUrl, baseUrl) ?? sourceUrl,
        title,
        company: asString(payload.company) ?? raw.metadata.company,
        location,
        city: asString(payload.city) ?? split.city,
        country: asString(payload.country) ?? split.country,
        remote:
          remoteValue === 'true' ||
          remoteValue === 'yes' ||
          remoteValue === '1' ||
          looksRemote(location, title),
        employmentType: normalizeEmploymentType(asString(payload.employmentType)),
        descriptionHtml,
        descriptionText: htmlToText(descriptionHtml),
        skills:
          asString(payload.skills)
            ?.split(',')
            .map((skill) => skill.trim())
            .filter(Boolean) ?? [],
        ...salary,
        applyMethod: 'external_ats',
        postedAt: asString(payload.postedAt),
        expiresAt: asString(payload.expiresAt),
      },
      raw.metadata.sourceUrl,
    );
  }
}

interface Selection {
  readonly length: number;
  find(selector: string): Selection;
  first(): Selection;
  attr(name: string): string | undefined;
  text(): string;
}

function pick($: CheerioAPI, element: Selection, selector: string): string | undefined {
  if (!selector) return undefined;
  const [rawSelector, attribute] = selector.split('@');
  const target = rawSelector === 'self' || rawSelector === '' ? element : element.find(rawSelector).first();
  if (!target.length) return undefined;
  if (attribute) return target.attr(attribute)?.trim();
  return target.text().trim() || undefined;
}
