import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { CrawlerHttp } from '../http';
import { JobDto, RawJob } from '../dto/job.dto';
import { htmlToText, normalizeEmploymentType, splitLocation } from '../crawler.utils';
import { SourceAdapter, asNumber, asString, parseSalary } from './source-adapter.interface';

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

  async *fetch(source: Source): AsyncIterable<RawJob> {
    const limit = asNumber(source.config.limit) ?? 100;
    const category = asString(source.config.category);
    const params = new URLSearchParams({ limit: String(limit) });
    if (category) {
      params.set('category', category);
    }
    const url = `https://remotive.com/api/remote-jobs?${params.toString()}`;
    const body = await this.http.getOrThrow(url, { accept: 'application/json' });
    const parsed = JSON.parse(body) as { jobs?: RemotiveJob[] };
    for (const job of parsed.jobs ?? []) {
      yield job as unknown as RawJob;
    }
  }

  normalize(raw: RawJob): JobDto {
    const job = raw as RemotiveJob;
    const title = asString(job.title) ?? 'Untitled role';
    const location = asString(job.candidate_required_location);
    const split = splitLocation(location);
    const descriptionHtml = asString(job.description) ?? '<p></p>';
    const salary = parseSalary(asString(job.salary));

    return {
      externalId: asString(job.id),
      sourceUrl: asString(job.url) ?? 'https://remotive.com',
      applyUrl: asString(job.url),
      title,
      company: asString(job.company_name) ?? 'Unknown company',
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
      postedAt: job.publication_date ? new Date(job.publication_date) : undefined,
      category: asString(job.category),
    };
  }
}
