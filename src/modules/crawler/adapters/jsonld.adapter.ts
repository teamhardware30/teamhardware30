import { Injectable, Logger } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { CrawlerHttp } from '../http';
import { JobDto, RawJob } from '../dto/job.dto';
import { htmlToText, looksRemote, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { SourceAdapter, absoluteUrl, asNumber, asString, firstString } from './source-adapter.interface';
import { load } from 'cheerio';

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
  streetAddress?: string;
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
  employmentType?: string | string[];
  hiringOrganization?: { name?: string } | string;
  jobLocation?: JobLocation | JobLocation[];
  jobLocationType?: string | string[];
  baseSalary?: BaseSalary;
  url?: string;
  identifier?: { value?: string } | string;
  directApply?: boolean;
  applicantLocationRequirements?: unknown;
}

@Injectable()
export class JsonLdAdapter implements SourceAdapter {
  readonly kind = 'jsonld' as const;
  private readonly logger = new Logger(JsonLdAdapter.name);

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawJob> {
    const config = source.config as JsonLdConfig;
    const detailUrls = await this.collectDetailUrls(source, config);
    const maxPages = asNumber(config.maxPages) ?? 50;

    for (const url of detailUrls.slice(0, maxPages)) {
      let html: string;
      try {
        html = await this.http.getOrThrow(url);
      } catch (error) {
        this.logger.warn(`Could not fetch JSON-LD detail page ${url}: ${(error as Error).message}`);
        continue;
      }

      for (const posting of extractJobPostings(html)) {
        yield { ...posting, __html: html, __url: url };
      }
    }
  }

  normalize(raw: RawJob): JobDto {
    const posting = raw as unknown as JobPosting & { __url?: string };
    const title = asString(posting.title) ?? 'Untitled role';
    const organization = posting.hiringOrganization;
    const company =
      (typeof organization === 'string' ? asString(organization) : asString(organization?.name)) ?? 'Unknown company';

    const location = extractLocation(posting.jobLocation);
    const split = splitLocation(location);
    const descriptionHtml = asString(posting.description) ?? '<p></p>';
    const locationType = firstString(posting.jobLocationType) ?? '';
    const salary = extractSalary(posting.baseSalary);

    return {
      externalId: extractIdentifier(posting.identifier),
      sourceUrl: asString(posting.url) ?? posting.__url ?? '',
      applyUrl: asString(posting.url) ?? posting.__url,
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
      applyMethod: posting.directApply === true ? 'onsite' : 'external_ats',
      postedAt: posting.datePosted ? new Date(posting.datePosted) : undefined,
    };
  }

  private async collectDetailUrls(source: Source, config: JsonLdConfig): Promise<string[]> {
    const pattern = config.urlPattern ? new RegExp(config.urlPattern) : undefined;
    const base = source.baseUrl;
    const urls = new Set<string>();

    if (config.sitemapUrl) {
      const sitemapUrls = [config.sitemapUrl];
      const seenSitemaps = new Set<string>();
      while (sitemapUrls.length > 0 && seenSitemaps.size < 10) {
        const sitemapUrl = sitemapUrls.shift();
        if (!sitemapUrl || seenSitemaps.has(sitemapUrl)) {
          continue;
        }
        seenSitemaps.add(sitemapUrl);
        const xml = await this.http.getOrThrow(sitemapUrl, { accept: 'application/xml,text/xml' });
        const $ = load(xml, { xmlMode: true });
        $('loc').each((_, element) => {
          const loc = $(element).text().trim();
          if (!loc) {
            return;
          }
          if (/\.xml(\.gz)?($|\?)/i.test(loc)) {
            sitemapUrls.push(loc);
          } else if (!pattern || pattern.test(loc)) {
            urls.add(loc);
          }
        });
      }
      return [...urls];
    }

    if (config.listingUrl) {
      const html = await this.http.getOrThrow(config.listingUrl);
      const $ = load(html);
      const selector = config.detailLinkSelector ?? 'a[href]';
      $(selector).each((_, element) => {
        const href = absoluteUrl($(element).attr('href'), config.listingUrl ?? base);
        if (href && (!pattern || pattern.test(href))) {
          urls.add(href);
        }
      });
      return [...urls];
    }

    throw new Error(`JSON-LD source ${source.name} needs config.sitemapUrl or config.listingUrl`);
  }
}

function extractJobPostings(html: string): JobPosting[] {
  const $ = load(html);
  const postings: JobPosting[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const text = $(element).text().trim();
    if (!text) {
      return;
    }
    try {
      collectJobPostings(JSON.parse(text), postings);
    } catch {
      // A single malformed block shouldn't discard the rest of the page.
    }
  });

  return postings;
}

function collectJobPostings(value: unknown, out: JobPosting[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectJobPostings(entry, out);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record['@type']) ? record['@type'] : [record['@type']];
  if (types.some((type) => typeof type === 'string' && type.toLowerCase() === 'jobposting')) {
    out.push(record as JobPosting);
  }
  if (record['@graph']) {
    collectJobPostings(record['@graph'], out);
  }
}

function extractLocation(jobLocation: JobPosting['jobLocation']): string | undefined {
  const location = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  if (!location) {
    return undefined;
  }
  if (typeof location.address === 'string') {
    return asString(location.address);
  }
  const address = location.address;
  if (!address) {
    return undefined;
  }
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map((part) => asString(part))
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function extractIdentifier(identifier: JobPosting['identifier']): string | undefined {
  if (typeof identifier === 'string') {
    return asString(identifier);
  }
  return asString(identifier?.value);
}

function extractSalary(baseSalary: BaseSalary | undefined): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: 'year' | 'month' | 'day' | 'hour';
} {
  if (!baseSalary) {
    return {};
  }
  const value = baseSalary.value;
  const salaryValue: SalaryValue = typeof value === 'object' && value !== null ? value : { value };
  const min = asNumber(salaryValue.minValue ?? salaryValue.value);
  const max = asNumber(salaryValue.maxValue ?? salaryValue.value);
  const unit = (salaryValue.unitText ?? '').toLowerCase();
  const period = unit.includes('hour')
    ? 'hour'
    : unit.includes('day')
      ? 'day'
      : unit.includes('month')
        ? 'month'
        : 'year';

  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: asString(baseSalary.currency),
    salaryPeriod: period,
  };
}
