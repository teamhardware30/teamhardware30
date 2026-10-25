import { createHash } from 'crypto';
import * as cheerio from 'cheerio';

/** Lowercase, strip accents/punctuation, and collapse whitespace. */
export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Stable dedupe key: SHA-1 of normalized title|company|city. The city falls
 * back to the location string so adapters that only expose a location still
 * dedupe sensibly.
 */
export function jobFingerprint(title: string, company: string, city?: string | null): string {
  const key = [normalizeText(title), normalizeText(company), normalizeText(city)].join('|');
  return createHash('sha1').update(key).digest('hex');
}

/** Convert an HTML fragment to plain text suitable for full-text search. */
export function htmlToText(html: string): string {
  if (!html) {
    return '';
  }
  const $ = cheerio.load(html);
  $('script, style, noscript, template').remove();
  return $('body')
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape text for safe interpolation into HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const REMOTE_PATTERN = /\b(remote|anywhere|work from home|distributed)\b/i;

export function looksRemote(location?: string | null, title?: string | null, extra?: string | null): boolean {
  return REMOTE_PATTERN.test([location, title, extra].filter(Boolean).join(' '));
}

/** Best-effort "City, Country" split for locations like "Nairobi, Kenya". */
export function splitLocation(location?: string | null): { city?: string; country?: string } {
  if (!location) {
    return {};
  }
  const parts = location
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return {};
  }
  if (parts.length === 1) {
    return { city: parts[0] };
  }
  return { city: parts[0], country: parts[parts.length - 1] };
}

/** Normalize common employment-type spellings to the stored enum-ish values. */
export function normalizeEmploymentType(value?: string | null): JobDtoEmploymentType | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = normalizeText(value);
  if (/intern/.test(normalized)) return 'internship';
  if (/part time|parttime/.test(normalized)) return 'part_time';
  if (/contract|freelance|temporary|temp\b/.test(normalized)) return 'contract';
  if (/full time|fulltime|permanent/.test(normalized)) return 'full_time';
  if (/temporary/.test(normalized)) return 'temporary';
  return 'other';
}

type JobDtoEmploymentType = 'full_time' | 'part_time' | 'contract' | 'internship' | 'temporary' | 'other';
