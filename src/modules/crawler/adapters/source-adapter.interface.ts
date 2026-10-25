import { Source } from '../../../db/schema';
import { JobDto, RawItem} from '../dto/job.dto';
import { canonicalHttpUrl } from '../dto/job.dto';
import { CrawlRequestOptions } from '../http';
import { AdapterSchemaError } from './errors';

/** Contract every job source implements. Invalid items fail at normalize(), not mid-upsert. */
export interface SourceAdapter {
  readonly kind: Source['kind'];
  fetch(source: Source): AsyncIterable<RawItem>;
  normalize(raw: RawItem): JobDto;
}

export interface CompanyToken {
  token: string;
  name?: string;
}

/** Accept `token`, `tokens`, or `companies: [{ token, name }]` in source config. */
export function resolveCompanyTokens(config: Record<string, unknown>): CompanyToken[] {
  const companies = config.companies;
  if (Array.isArray(companies)) {
    return companies
      .map((entry) => {
        if (typeof entry === 'string') {
          return { token: entry };
        }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>;
          const token = asString(record.token);
          if (token) {
            return { token, name: asString(record.name) };
          }
        }
        return null;
      })
      .filter((entry): entry is CompanyToken => entry !== null);
  }

  const tokens = config.tokens;
  if (Array.isArray(tokens)) {
    return tokens
      .map((token) => asString(token))
      .filter((token): token is string => Boolean(token))
      .map((token) => ({ token }));
  }

  const token = asString(config.token);
  return token ? [{ token }] : [];
}

export function sourceRequestOptions(source: Source, accept?: string): CrawlRequestOptions {
  const configuredRate = asNumber(source.config.requestsPerSecond);
  return {
    sourceId: source.id,
    requestsPerSecond: configuredRate && configuredRate > 0 ? configuredRate : undefined,
    accept,
  };
}

export function parseJson(body: string, sourceUrl: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new AdapterSchemaError(`Malformed JSON returned by ${sourceUrl}`, sourceUrl, { cause: error });
  }
}

export function recordValue(value: unknown, sourceUrl: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AdapterSchemaError(`Expected a JSON object from ${sourceUrl}`, sourceUrl);
  }
  return value as Record<string, unknown>;
}

export function recordArray(value: unknown, sourceUrl: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new AdapterSchemaError(`Expected a JSON array from ${sourceUrl}`, sourceUrl);
  }
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry));
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = asString(entry);
      if (result) {
        return result;
      }
    }
    return undefined;
  }
  return asString(value);
}

export function absoluteUrl(value: unknown, base: string): string | undefined {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }
  try {
    return canonicalHttpUrl(new URL(raw, base).toString());
  } catch {
    return undefined;
  }
}

/** Parse "$120k - $150k", "€60,000/year", etc. into a min/max pair. */
export function parseSalary(text: string | undefined): {
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: 'year' | 'month' | 'day' | 'hour';
} {
  if (!text) {
    return {};
  }
  const currencySymbol = text.match(/[$€£¥]/)?.[0];
  const currency = currencySymbol
    ? ({ $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' } as Record<string, string>)[currencySymbol]
    : /\b[A-Z]{3}\b/.test(text)
      ? text.match(/\b[A-Z]{3}\b/)?.[0]
      : undefined;

  const period = /\b(hour|hr)\b/i.test(text)
    ? 'hour'
    : /\b(day|daily)\b/i.test(text)
      ? 'day'
      : /\b(month|monthly)\b/i.test(text)
        ? 'month'
        : 'year';

  const numbers = [...text.matchAll(/(\d[\d,.]*)\s*(k)?/gi)]
    .map((match) => {
      const raw = Number(match[1].replace(/,/g, ''));
      if (!Number.isFinite(raw)) {
        return undefined;
      }
      return match[2] ? raw * 1_000 : raw;
    })
    .filter((value): value is number => value !== undefined && value >= 100);

  if (numbers.length === 0) {
    return { salaryCurrency: currency, salaryPeriod: period };
  }
  return {
    salaryMin: Math.min(...numbers),
    salaryMax: numbers.length > 1 ? Math.max(...numbers) : undefined,
    salaryCurrency: currency,
    salaryPeriod: period,
  };
}
