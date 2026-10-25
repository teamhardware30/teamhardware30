import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { escapeHtml, htmlToText, looksRemote, normalizeEmploymentType, splitLocation } from '../crawler.utils';
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
  resolveCompanyTokens,
  sourceRequestOptions,
} from './source-adapter.interface';

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  description?: string;
  additional?: string;
  lists?: Array<{ text?: string; content?: string }>;
  categories?: { location?: string; team?: string; department?: string; commitment?: string };
}

@Injectable()
export class LeverAdapter implements SourceAdapter {
  readonly kind = 'lever' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawItem> {
    for (const { token, name } of resolveCompanyTokens(source.config)) {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
      const body = await this.http.getOrThrow(url, sourceRequestOptions(source, 'application/json'));
      for (const posting of recordArray(parseJson(body, url), url)) {
        yield rawItem(posting, {
          sourceId: source.id,
          sourceName: source.name,
          baseUrl: source.baseUrl,
          sourceUrl: asString(posting.hostedUrl),
          company: name ?? token,
          token,
        });
      }
    }
  }

  normalize(raw: RawItem): JobDto {
    const posting = raw.payload as unknown as LeverPosting;
    const title = asString(posting.text);
    const location = asString(posting.categories?.location);
    const descriptionHtml = [
      asString(posting.description) ?? '',
      ...(posting.lists ?? []).map(
        (list) => `<h3>${escapeHtml(asString(list.text) ?? '')}</h3>${asString(list.content) ?? ''}`,
      ),
      asString(posting.additional) ?? '',
    ]
      .filter(Boolean)
      .join('\n');
    const baseUrl = raw.metadata.baseUrl ?? 'https://jobs.lever.co';
    const sourceUrl = absoluteUrl(posting.hostedUrl, baseUrl);

    return normalizeJobDto(
      {
        externalId: asString(posting.id),
        sourceUrl: sourceUrl ?? `https://jobs.lever.co/${raw.metadata.token ?? ''}`,
        applyUrl: absoluteUrl(posting.applyUrl, baseUrl) ?? sourceUrl,
        title,
        company: raw.metadata.company,
        location,
        city: splitLocation(location).city,
        country: splitLocation(location).country,
        remote: looksRemote(location, title),
        employmentType: normalizeEmploymentType(posting.categories?.commitment),
        descriptionHtml: descriptionHtml || '<p></p>',
        descriptionText: htmlToText(descriptionHtml),
        skills: [asString(posting.categories?.team), asString(posting.categories?.department)].filter(
          (value): value is string => Boolean(value),
        ),
        applyMethod: 'external_ats',
        postedAt: posting.createdAt ? new Date(posting.createdAt) : undefined,
      },
      raw.metadata.sourceUrl,
    );
  }
}
