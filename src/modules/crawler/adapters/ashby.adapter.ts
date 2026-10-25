import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { CrawlerHttp } from '../http';
import { JobDto, RawJob } from '../dto/job.dto';
import { htmlToText, looksRemote, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { SourceAdapter, asString, resolveCompanyTokens } from './source-adapter.interface';

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  department?: string;
  team?: string;
  employmentType?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
  applyUrl?: string;
  jobUrl?: string;
  isRemote?: boolean;
  compensation?: {
    compensationTierSummary?: string;
    scrapeableCompensationSalarySummary?: string;
  };
}

@Injectable()
export class AshbyAdapter implements SourceAdapter {
  readonly kind = 'ashby' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawJob> {
    for (const { token, name } of resolveCompanyTokens(source.config)) {
      const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`;
      const body = await this.http.getOrThrow(url, { accept: 'application/json' });
      const parsed = JSON.parse(body) as { jobs?: AshbyJob[] };
      for (const job of parsed.jobs ?? []) {
        yield { ...(job as unknown as RawJob), __company: name ?? token, __token: token };
      }
    }
  }

  normalize(raw: RawJob): JobDto {
    const job = raw as unknown as AshbyJob & { __company?: string };
    const title = asString(job.title) ?? 'Untitled role';
    const location = asString(job.location);
    const descriptionHtml = asString(job.descriptionHtml) ?? `<p>${asString(job.descriptionPlain) ?? ''}</p>`;
    const split = splitLocation(location);

    return {
      externalId: asString(job.id),
      sourceUrl: asString(job.jobUrl) ?? asString(job.applyUrl) ?? `https://jobs.ashbyhq.com/${job.__company ?? ''}`,
      applyUrl: asString(job.applyUrl) ?? asString(job.jobUrl),
      title,
      company: asString(job.__company) ?? 'Unknown company',
      location,
      city: split.city,
      country: split.country,
      remote: job.isRemote === true || looksRemote(location, title),
      employmentType: normalizeEmploymentType(job.employmentType),
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      skills: [asString(job.department), asString(job.team)].filter((value): value is string => Boolean(value)),
      applyMethod: 'external_ats',
      postedAt: job.publishedAt ? new Date(job.publishedAt) : undefined,
    };
  }
}
