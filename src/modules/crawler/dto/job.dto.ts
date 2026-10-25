import sanitizeHtml from 'sanitize-html';
import { z, ZodError } from 'zod';
import { AdapterSchemaError } from '../adapters/errors';

export const applyMethodValues = ['onsite', 'email', 'external_ats'] as const;
export const employmentTypeValues = ['full_time', 'part_time', 'contract', 'internship', 'temporary', 'other'] as const;
export const salaryPeriodValues = ['year', 'month', 'day', 'hour'] as const;

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|source$)/i;

export function canonicalHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP(S) job URLs are allowed');
  }
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  return url.toString();
}

const requiredUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .url()
  .transform(canonicalHttpUrl)
  .refine((value) => /^https?:\/\//.test(value), 'Only HTTP(S) URLs are allowed');

const optionalUrl = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  requiredUrl.optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.coerce.date().optional(),
);

const optionalSalary = z.preprocess(
  (value) => {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value === 'string') return Number(value.replace(/,/g, ''));
    return value;
  },
  z.number().int().nonnegative().max(1_000_000_000).optional(),
);

/** Sanitize at the ingestion boundary as well as at render time. */
function cleanDescription(value: string): string {
  return sanitizeHtml(value, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  }).trim();
}

/**
 * Canonical data accepted from every adapter. Optional scalar values deliberately
 * coerce empty strings to undefined instead of zero/Invalid Date.
 */
export const jobDtoSchema = z
  .object({
    externalId: z.string().trim().min(1).max(500).optional(),
    sourceUrl: requiredUrl,
    applyUrl: optionalUrl,

    title: z.string().trim().min(1).max(500),
    company: z.string().trim().min(1).max(300),
    location: z.string().trim().min(1).max(500).optional(),
    city: z.string().trim().min(1).max(200).optional(),
    country: z.string().trim().min(1).max(200).optional(),
    remote: z.boolean().default(false),
    employmentType: z.enum(employmentTypeValues).optional(),

    descriptionHtml: z.string().min(1).transform(cleanDescription).refine((value) => value.length > 0, {
      message: 'Description must contain safe content',
    }),
    descriptionText: z.string().trim().max(1_000_000).optional(),
    skills: z.array(z.string().trim().min(1).max(200)).max(100).default([]),

    salaryMin: optionalSalary,
    salaryMax: optionalSalary,
    salaryCurrency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase())
      .optional(),
    salaryPeriod: z.enum(salaryPeriodValues).optional(),

    applyMethod: z.enum(applyMethodValues).default('external_ats'),
    applyEmail: z.string().trim().email().max(320).optional(),

    postedAt: optionalDate,
    expiresAt: optionalDate,
    category: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((job, context) => {
    if (job.salaryMin !== undefined && job.salaryMax !== undefined && job.salaryMin > job.salaryMax) {
      context.addIssue({ code: 'custom', path: ['salaryMax'], message: 'Salary maximum must be at least the minimum' });
    }
    if (job.applyMethod === 'email' && !job.applyEmail) {
      context.addIssue({ code: 'custom', path: ['applyEmail'], message: 'Email applications need an email address' });
    }
  });

export type JobDto = z.infer<typeof jobDtoSchema>;
export type JobDtoInput = z.input<typeof jobDtoSchema>;

export function normalizeJobDto(input: unknown, sourceUrl?: string): JobDto {
  try {
    return jobDtoSchema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const reason = error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join('.') || 'item'}: ${issue.message}`)
        .join('; ');
      throw new AdapterSchemaError(`Invalid normalized job (${reason})`, sourceUrl, { cause: error });
    }
    throw error;
  }
}

export interface RawItemMetadata {
  sourceId?: string;
  sourceName?: string;
  baseUrl?: string;
  sourceUrl?: string;
  company?: string;
  token?: string;
  fetchedAt: string;
  /** A fatal per-item fetch/parse error. The crawl records it and continues. */
  error?: string;
  /** Non-fatal problems, such as a detail description that could not be fetched. */
  warnings?: string[];
}

/** Raw payload plus lineage, retained in memory for normalization/reprocessing. */
export interface RawItem {
  payload: Record<string, unknown>;
  metadata: RawItemMetadata;
}

export type RawJob = RawItem;

export function rawItem(
  payload: Record<string, unknown>,
  metadata: Omit<RawItemMetadata, 'fetchedAt'> & { fetchedAt?: string },
): RawItem {
  return { payload, metadata: { ...metadata, fetchedAt: metadata.fetchedAt ?? new Date().toISOString() } };
}
