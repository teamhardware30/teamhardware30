import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { CrawlerHttp } from '../http';
import { JobDto, RawJob } from '../dto/job.dto';
import { htmlToText, looksRemote } from '../crawler.utils';
import { SourceAdapter, asString, resolveCompanyTokens } from './source-adapter.interface';

interface GreenhouseJob {
  id?: number | string;
  title?: string;
  absolute_url?: string;
  updated_at?: string;
  content?: string;
  location?: { name?: string };
  metadata?: Array<{ name?: string; value?: unknown }>;
}

@Injectable()
export class GreenhouseAdapter implements SourceAdapter {
  readonly kind = 'greenhouse' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawJob> {
    for (const { token, name } of resolveCompanyTokens(source.config)) {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
      const body = await this.http.getOrThrow(url, { accept: 'application/json' });
      const parsed = JSON.parse(body) as { jobs?: GreenhouseJob[] };
      for (const job of parsed.jobs ?? []) {
        yield { ...(job as unknown as RawJob), __company: name ?? token, __token: token };
      }
    }
  }

  normalize(raw: RawJob): JobDto {
    const job = raw as unknown as GreenhouseJob & { __company?: string; __token?: string };
    const location = asString(job.location?.name);
    const title = asString(job.title) ?? 'Untitled role';
    const descriptionHtml = asString(job.content) ?? '<p></p>';
    const skills = (job.metadata ?? [])
      .filter((entry) => /skill|technolog|tag/i.test(entry.name ?? ''))
      .flatMap((entry) => (Array.isArray(entry.value) ? entry.value : [entry.value]))
      .map((value) => asString(value))
      .filter((value): value is string => Boolean(value));

    return {
      externalId: asString(job.id),
      sourceUrl: asString(job.absolute_url) ?? `https://boards.greenhouse.io/${job.__token ?? ''}`,
      applyUrl: asString(job.absolute_url),
      title,
      company: asString(job.__company) ?? 'Unknown company',
      location,
      remote: looksRemote(location, title),
      descriptionHtml,
      descriptionText: htmlToText(descriptionHtml),
      skills,
      applyMethod: 'external_ats',
      postedAt: job.updated_at ? new Date(job.updated_at) : undefined,
    };
  }
}
