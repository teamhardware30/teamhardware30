import { Injectable } from '@nestjs/common';
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
  parseJson,
  recordArray,
  recordValue,
  sourceRequestOptions,
} from './source-adapter.interface';

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

  async *fetch(source: Source): AsyncIterable<RawItem> {
    const maxPages = Math.min(Math.max(asNumber(source.config.maxPages) ?? 5, 1), 100);
    let url: string | undefined = 'https://www.arbeitnow.com/api/job-board-api';
    const visited = new Set<string>();
    let page = 0;

    while (url && page < maxPages && !visited.has(url)) {
      visited.add(url);
      const body = await this.http.getOrThrow(url, sourceRequestOptions(source, 'application/json'));
      const payload = recordValue(parseJson(body, url), url);
      for (const job of recordArray(payload.data, url)) {
        yield rawItem(job, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          sourceUrl: asString(job.url),
        });
      }
      const links = payload.links && typeof payload.links === 'object' ? (payload.links as Record<string, unknown>) : {};
      url = absoluteUrl(links.next, 'https://www.arbeitnow.com');
      page += 1;
    }
  }

  normalize(raw: RawItem): JobDto {
    const job = raw.payload as unknown as ArbeitnowJob;
    const title = asString(job.title);
    const location = asString(job.location);
    const split = splitLocation(location);
    const descriptionHtml = asString(job.description) ?? '<p></p>';
    const createdAt = asNumber(job.created_at);
    const baseUrl = raw.metadata.baseUrl ?? 'https://www.arbeitnow.com';

    return normalizeJobDto(
      {
        externalId: asString(job.slug),
        sourceUrl: absoluteUrl(job.url, baseUrl) ?? baseUrl,
        applyUrl: absoluteUrl(job.url, baseUrl),
        title,
        company: asString(job.company_name),
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
      },
      raw.metadata.sourceUrl,
    );
  }
}
