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
  asString,
  parseJson,
  recordArray,
  recordValue,
  resolveCompanyTokens,
  sourceRequestOptions,
} from './source-adapter.interface';

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  applyUrl?: string;
  jobUrl?: string;
  isRemote?: boolean;
  compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
}

@Injectable()
export class AshbyAdapter implements SourceAdapter {
  readonly kind = 'ashby' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawItem> {
    for (const { token, name } of resolveCompanyTokens(source.config)) {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
      const body = await this.http.getOrThrow(url, sourceRequestOptions(source, 'application/json'));
      const payload = recordValue(parseJson(body, url), url);
      for (const job of recordArray(payload.jobs, url)) {
        yield rawItem(job, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          sourceUrl: asString(job.jobUrl) ?? asString(job.applyUrl),
          company: name ?? token,
          token,
        });
      }
    }
  }

  normalize(raw: RawItem): JobDto {
    const job = raw.payload as unknown as AshbyJob;
    const title = asString(job.title);
    const location = asString(job.location);
    const descriptionHtml = asString(job.descriptionHtml) ?? `<p>${asString(job.descriptionPlain) ?? ''}</p>`;
    const split = splitLocation(location);
    const baseUrl = raw.metadata.baseUrl ?? 'https://jobs.ashbyhq.com';

    return normalizeJobDto(
      {
        externalId: asString(job.id),
        sourceUrl:
          absoluteUrl(job.jobUrl, baseUrl) ??
          absoluteUrl(job.applyUrl, baseUrl) ??
          `https://jobs.ashbyhq.com/${raw.metadata.token ?? ''}`,
        applyUrl: absoluteUrl(job.applyUrl, baseUrl) ?? absoluteUrl(job.jobUrl, baseUrl),
        title,
        company: raw.metadata.company,
        location,
        city: split.city,
        country: split.country,
        remote: job.isRemote === true || looksRemote(location, title),
        employmentType: normalizeEmploymentType(job.employmentType),
        descriptionHtml,
        descriptionText: htmlToText(descriptionHtml),
        skills: [asString(job.department), asString(job.team)].filter((value): value is string => Boolean(value)),
        applyMethod: 'external_ats',
        postedAt: job.publishedAt,
      },
      raw.metadata.sourceUrl,
    );
  }
}
