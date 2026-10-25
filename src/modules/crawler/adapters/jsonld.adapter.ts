import { Injectable } from '@nestjs/common';
import { load } from 'cheerio';
import { Source } from '../../../db/schema';
import { htmlToText, looksRemote, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { JobDto, RawItem} from '../dto/job.dto';
import { normalizeJobDto, rawItem } from '../dto/job.dto';
import { CrawlerHttp } from '../http';
import {
  SourceAdapter} from './source-adapter.interface';
import {
  absoluteUrl,
  asNumber,
  asString,
  firstString,
  sourceRequestOptions,
} from './source-adapter.interface';

interface JsonLdConfig {
  sitemapUrl?: string;
  listingUrl?: string;
  urlPattern?: string;
  detailLinkSelector?: string;
  maxPages?: number;
}

interface PostalAddress {
  addressLocality?: string;
  addressRegion?: string;
  addressCountry?: string;
}

interface JobLocation {
  address?: PostalAddress | string;
}

interface SalaryValue {
  minValue?: number | string;
  maxValue?: number | string;
  value?: number | string;
  unitText?: string;
}

interface BaseSalary {
  currency?: string;
  value?: SalaryValue | number | string;
}

interface JobPosting {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  validThrough?: string;
  employmentType?: string | string[];
  hiringOrganization?: { name?: string } | string;
  jobLocation?: JobLocation | JobLocation[];
  jobLocationType?: string | string[];
  baseSalary?: BaseSalary;
  url?: string;
  identifier?: { value?: string } | string;
  directApply?: boolean;
}

@Injectable()
export class JsonLdAdapter implements SourceAdapter {
  readonly kind = 'jsonld' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawItem> {
    const config = source.config as JsonLdConfig;
    const detailUrls = await this.collectDetailUrls(source, config);
    const maxPages = Math.min(Math.max(asNumber(config.maxPages) ?? 50, 1), 1_000);

    for (const url of detailUrls.slice(0, maxPages)) {
      let html: string;
      try {
        html = await this.http.getOrThrow(url, sourceRequestOptions(source));
      } catch (error) {
        yield rawItem({}, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          sourceUrl: url,
          error: (error as Error).message,
        });
        continue;
      }

      const extracted = extractJobPostings(html);
      for (const error of extracted.errors) {
        yield rawItem({}, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          sourceUrl: url,
          error,
        });
      }
      for (const posting of extracted.postings) {
        yield rawItem(posting as unknown as Record<string, unknown>, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          sourceUrl: url,
        });
      }
    }
  }

  normalize(raw: RawItem): JobDto {
    const posting = raw.payload as unknown as JobPosting;
    const title = asString(posting.title);
    const organization = posting.hiringOrganization;
    const company = typeof organization === 'string' ? asString(organization) : asString(organization?.name);
    const location = extractLocation(posting.jobLocation);
    const split = splitLocation(location);
    const descriptionHtml = asString(posting.description) ?? '<p></p>';
    const locationType = firstString(posting.jobLocationType) ?? '';
    const salary = extractSalary(posting.baseSalary);
    const detailUrl = raw.metadata.sourceUrl ?? raw.metadata.baseUrl ?? '';
    const postingUrl = absoluteUrl(posting.url, detailUrl);

    return normalizeJobDto(
      {
        externalId: extractIdentifier(posting.identifier),
        sourceUrl: postingUrl ?? detailUrl,
        applyUrl: postingUrl ?? absoluteUrl(detailUrl, detailUrl),
        title,
        company,
        location,
        city: split.city,
        country: split.country,
        remote: /telecommute/i.test(locationType) || looksRemote(location, title),
        employmentType: normalizeEmploymentType(firstString(posting.employmentType)),
        descriptionHtml,
        descriptionText: htmlToText(descriptionHtml),
        skills: [],
        ...salary,
        // schema.org directApply does not make an external posting an onsite application.
        applyMethod: 'external_ats',
        postedAt: posting.datePosted,
        expiresAt: posting.validThrough,
      },
      raw.metadata.sourceUrl,
    );
  }

  private async collectDetailUrls(source: Source, config: JsonLdConfig): Promise<string[]> {
    const pattern = config.urlPattern ? new RegExp(config.urlPattern) : undefined;
    const urls = new Set<string>();

    if (config.sitemapUrl) {
      const sitemapUrls = [config.sitemapUrl];
      const seenSitemaps = new Set<string>();
      while (sitemapUrls.length > 0 && seenSitemaps.size < 10) {
        const sitemapUrl = sitemapUrls.shift();
        if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) continue;
        seenSitemaps.add(sitemapUrl);
        const xml = await this.http.getOrThrow(sitemapUrl, sourceRequestOptions(source, 'application/xml,text/xml'));
        const $ = load(xml, { xmlMode: true });
        $('loc').each((_, element) => {
          const loc = absoluteUrl($(element).text(), sitemapUrl);
          if (!loc) return;
          if (/\.xml(\.gz)?($|\?)/i.test(loc)) sitemapUrls.push(loc);
          else if (!pattern || pattern.test(loc)) urls.add(loc);
        });
      }
      return [...urls];
    }

    if (config.listingUrl) {
      const html = await this.http.getOrThrow(config.listingUrl, sourceRequestOptions(source));
      const $ = load(html);
      $(config.detailLinkSelector ?? 'a[href]').each((_, element) => {
        const href = absoluteUrl($(element).attr('href'), config.listingUrl ?? source.baseUrl);
        if (href && (!pattern || pattern.test(href))) urls.add(href);
      });
      return [...urls];
    }

    throw new Error(`JSON-LD source ${source.name} needs config.sitemapUrl or config.listingUrl`);
  }
}

function extractJobPostings(html: string): { postings: JobPosting[]; errors: string[] } {
  const $ = load(html);
  const postings: JobPosting[] = [];
  const errors: string[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const text = $(element).text().trim();
    if (!text) return;
    try {
      collectJobPostings(JSON.parse(decodeJsonEntities(text)), postings);
    } catch {
      errors.push('Malformed application/ld+json block');
    }
  });
  return { postings, errors };
}

function decodeJsonEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(/&(#x[0-9a-f]+|#\d+|quot|amp|apos|lt|gt);/gi, (entity, code: string) => {
    const named: Record<string, string> = { quot: '"', amp: '&', apos: "'", lt: '<', gt: '>' };
    const lower = code.toLowerCase();
    if (named[lower]) return named[lower];
    const number = lower.startsWith('#x') ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return Number.isFinite(number) ? String.fromCodePoint(number) : entity;
  });
}

function collectJobPostings(value: unknown, out: JobPosting[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectJobPostings(entry, out);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
  if (types.some((type) => typeof type === 'string' && type.toLowerCase() === 'jobposting')) {
    out.push(record as JobPosting);
  }
  if (record['@graph']) collectJobPostings(record['@graph'], out);
}

function extractLocation(jobLocation: JobPosting['jobLocation']): string | undefined {
  const location = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  if (!location) return undefined;
  if (typeof location.address === 'string') return asString(location.address);
  const address = location.address;
  if (!address) return undefined;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((part) => asString(part))
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function extractIdentifier(identifier: JobPosting['identifier']): string | undefined {
  return typeof identifier === 'string' ? asString(identifier) : asString(identifier?.value);
}

function extractSalary(baseSalary: BaseSalary | undefined): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: 'year' | 'month' | 'day' | 'hour';
} {
  if (!baseSalary) return {};
  const value = baseSalary.value;
  const salaryValue: SalaryValue = typeof value === 'object' && value !== null ? value : { value };
  const min = asNumber(salaryValue.minValue ?? salaryValue.value);
  const max = asNumber(salaryValue.maxValue ?? salaryValue.value);
  const unit = (salaryValue.unitText ?? '').toLowerCase();
  const period = unit.includes('hour') ? 'hour' : unit.includes('day') ? 'day' : unit.includes('month') ? 'month' : 'year';
  return { salaryMin: min, salaryMax: max, salaryCurrency: asString(baseSalary.currency), salaryPeriod: period };
}
