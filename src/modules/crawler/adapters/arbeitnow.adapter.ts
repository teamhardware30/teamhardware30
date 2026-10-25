import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { CrawlerHttp } from '../http';
import { JobDto, RawJob } from '../dto/job.dto';
import { htmlToText, looksRemote, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { SourceAdapter, absoluteUrl, asNumber, asString, firstString } from './source-adapter.interface';

interface ArbeitnowJob {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
}

@Injectable()
export class ArbeitnowAdapter implements SourceAdapter {
  readonly kind = 'arbeitnow' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawJob> {
    const maxPages = asNumber(source.config.maxPages) ?? 5;
    let url: string | undefined = 'https://www.arbeitnow.com/api/job-board-api';
    let page = 0;

    while (url && page < maxPages) {
      const body = await this.http.getOrThrow(url, { accept: 'application/json' });
      const parsed = JSON.parse(body) as { data?: ArbeitnowJob[]; links?: { next?: string | null } };
      for (const job of parsed.data ?? []) {
        yield job as unknown as RawJob;
      }
      url = absoluteUrl(parsed.links?.next, 'https://www.arbeitnow.com');
      page += 1;
    }
  }

  normalize(raw: RawJob): JobDto {
    const job = raw as ArbeitnowJob;
    const title = asString(job.title) ?? 'Untitled role';
    const location = asString(job.location);
    const split = splitLocation(location);
    const descriptionHtml = asString(job.description) ?? '<p></p>';
    const createdAt = asNumber(job.created_at);

    return {
      externalId: asString(job.slug),
      sourceUrl: asString(job.url) ?? 'https://www.arbeitnow.com',
      applyUrl: asString(job.url),
      title,
      company: asString(job.company_name) ?? 'Unknown company',
      location,
      city: split.city,
      country: split.country,
      remote: job.remote === true || looksRemote(location, title),
      employmentType: normalizeEmploymentType(firstString(job.job_types)),
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      skills: (job.tags ?? []).map((tag) => asString(tag)).filter((tag): tag is string => Boolean(tag)),
      applyMethod: 'external_ats',
      postedAt: createdAt ? new Date(createdAt * 1000) : undefined,
    };
  }
}
