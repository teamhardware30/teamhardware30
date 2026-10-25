import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { htmlToText, looksRemote } from '../crawler.utils';
import { JobDto, RawItem} from '../dto/job.dto';
import { normalizeJobDto, rawItem } from '../dto/job.dto';
import { CrawlerHttp } from '../http';
import {
  SourceAdapter} from './source-adapter.interface';
import {
  asString,
  parseJson,
  recordArray,
  recordValue,
  resolveCompanyTokens,
  sourceRequestOptions,
} from './source-adapter.interface';

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

  async *fetch(source: Source): AsyncIterable<RawItem> {
    for (const { token, name } of resolveCompanyTokens(source.config)) {
      const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
      const body = await this.http.getOrThrow(url, sourceRequestOptions(source, 'application/json'));
      const payload = recordValue(parseJson(body, url), url);
      for (const job of recordArray(payload.jobs, url)) {
        yield rawItem(job, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          sourceUrl: asString(job.absolute_url),
          company: name ?? token,
          token,
        });
      }
    }
  }

  normalize(raw: RawItem): JobDto {
    const job = raw.payload as unknown as GreenhouseJob;
    const location = asString(job.location?.name);
    const title = asString(job.title);
    const descriptionHtml = asString(job.content) ?? '<p></p>';
    const skills = (job.metadata ?? [])
      .filter((entry) => /skill|technolog|tag/i.test(entry.name ?? ''))
      .flatMap((entry) => (Array.isArray(entry.value) ? entry.value : [entry.value]))
      .map((value) => asString(value))
      .filter((value): value is string => Boolean(value));

    return normalizeJobDto(
      {
        externalId: asString(job.id),
        sourceUrl: asString(job.absolute_url) ?? `https://boards.greenhouse.io/${raw.metadata.token ?? ''}`,
        applyUrl: asString(job.absolute_url),
        title,
        company: raw.metadata.company,
        location,
        remote: looksRemote(location, title),
        descriptionHtml,
        descriptionText: htmlToText(descriptionHtml),
        skills,
        applyMethod: 'external_ats',
        postedAt: job.updated_at,
      },
      raw.metadata.sourceUrl,
    );
  }
}
