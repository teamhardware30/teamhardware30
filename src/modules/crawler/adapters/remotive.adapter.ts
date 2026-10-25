import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { htmlToText, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { JobDto, RawItem} from '../dto/job.dto';
import { normalizeJobDto, rawItem } from '../dto/job.dto';
import { CrawlerHttp } from '../http';
import {
  SourceAdapter} from './source-adapter.interface';
import {
  absoluteUrl,
  asNumber,
  asString,
  parseJson,
  parseSalary,
  recordArray,
  recordValue,
  sourceRequestOptions,
} from './source-adapter.interface';

interface RemotiveJob {
  id?: number | string;
  url?: string;
  title?: string;
  company_name?: string;
  category?: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  salary?: string;
  description?: string;
  tags?: string[];
}

@Injectable()
export class RemotiveAdapter implements SourceAdapter {
  readonly kind = 'remotive' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawItem> {
    const limit = Math.min(Math.max(asNumber(source.config.limit) ?? 100, 1), 1_000);
    const category = asString(source.config.category);
    const params = new URLSearchParams({ limit: String(limit) });
    if (category) params.set('category', category);
    const url = `https://remotive.com/api/remote-jobs?${params.toString()}`;
    const body = await this.http.getOrThrow(url, sourceRequestOptions(source, 'application/json'));
    const payload = recordValue(parseJson(body, url), url);
    for (const job of recordArray(payload.jobs, url)) {
      yield rawItem(job, {
        sourceId: source.id,
        sourceName: source.name,
        baseUrl: source.baseUrl,
        sourceUrl: asString(job.url),
      });
    }
  }

  normalize(raw: RawItem): JobDto {
    const job = raw.payload as unknown as RemotiveJob;
    const title = asString(job.title);
    const location = asString(job.candidate_required_location);
    const split = splitLocation(location);
    const descriptionHtml = asString(job.description) ?? '<p></p>';
    const salary = parseSalary(asString(job.salary));
    const baseUrl = raw.metadata.baseUrl ?? 'https://remotive.com';

    return normalizeJobDto(
      {
        externalId: asString(job.id),
        sourceUrl: absoluteUrl(job.url, baseUrl) ?? baseUrl,
        applyUrl: absoluteUrl(job.url, baseUrl),
        title,
        company: asString(job.company_name),
        location,
        city: split.city,
        country: split.country,
        remote: true,
        employmentType: normalizeEmploymentType(job.job_type),
        descriptionHtml,
        descriptionText: htmlToText(descriptionHtml),
        skills: (job.tags ?? []).map((tag) => asString(tag)).filter((tag): tag is string => Boolean(tag)),
        ...salary,
        applyMethod: 'external_ats',
        postedAt: job.publication_date,
        category: asString(job.category),
      },
      raw.metadata.sourceUrl,
    );
  }
}
