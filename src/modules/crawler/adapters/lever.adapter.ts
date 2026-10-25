import { Injectable } from '@nestjs/common';
import { Source } from '../../../db/schema';
import { CrawlerHttp } from '../http';
import { JobDto, RawJob } from '../dto/job.dto';
import { htmlToText, looksRemote, normalizeEmploymentType } from '../crawler.utils';
import { SourceAdapter, asString, resolveCompanyTokens } from './source-adapter.interface';

interface LeverList {
  text?: string;
  content?: string;
}

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  description?: string;
  descriptionPlain?: string;
  additional?: string;
  lists?: LeverList[];
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
}

@Injectable()
export class LeverAdapter implements SourceAdapter {
  readonly kind = 'lever' as const;

  constructor(private readonly http: CrawlerHttp) {}

  async *fetch(source: Source): AsyncIterable<RawJob> {
    for (const { token, name } of resolveCompanyTokens(source.config)) {
      const url = `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
      const body = await this.http.getOrThrow(url, { accept: 'application/json' });
      const postings = JSON.parse(body) as LeverPosting[];
      for (const posting of postings) {
        yield { ...(posting as unknown as RawJob), __company: name ?? token, __token: token };
      }
    }
  }

  normalize(raw: RawJob): JobDto {
    const posting = raw as unknown as LeverPosting & { __company?: string };
    const title = asString(posting.text) ?? 'Untitled role';
    const location = asString(posting.categories?.location);
    const descriptionHtml = [
      asString(posting.description) ?? '',
      ...(posting.lists ?? []).map((list) => `<h3>${asString(list.text) ?? ''}</h3>${asString(list.content) ?? ''}`),
      asString(posting.additional) ?? '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      externalId: asString(posting.id),
      sourceUrl: asString(posting.hostedUrl) ?? `https://jobs.lever.co/${posting.__company ?? ''}`,
      applyUrl: asString(posting.applyUrl) ?? asString(posting.hostedUrl),
      title,
      company: asString(posting.__company) ?? 'Unknown company',
      location,
      remote: looksRemote(location, title),
      employmentType: normalizeEmploymentType(posting.categories?.commitment),
      descriptionHtml: descriptionHtml || '<p></p>',
      descriptionText: htmlToText(descriptionHtml),
      skills: [asString(posting.categories?.team), asString(posting.categories?.department)].filter(
        (value): value is string => Boolean(value),
      ),
      applyMethod: 'external_ats',
      postedAt: posting.createdAt ? new Date(posting.createdAt) : undefined,
    };
  }
}
