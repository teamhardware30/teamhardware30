import { z } from 'zod';

export const applyMethodValues = ['onsite', 'email', 'external_ats'] as const;
export const employmentTypeValues = ['full_time', 'part_time', 'contract', 'internship', 'temporary', 'other'] as const;
export const salaryPeriodValues = ['year', 'month', 'day', 'hour'] as const;

/**
 * The normalized shape every source adapter must produce. Everything the
 * crawler writes to the jobs table flows through this schema, so adapters
 * can't accidentally persist half-populated records.
 */
export const jobDtoSchema = z.object({
  externalId: z.string().trim().max(500).optional(),
  sourceUrl: z.string().url(),
  applyUrl: z.string().url().optional(),

  title: z.string().trim().min(1).max(500),
  company: z.string().trim().min(1).max(300),
  location: z.string().trim().max(500).optional(),
  city: z.string().trim().max(200).optional(),
  country: z.string().trim().max(200).optional(),
  remote: z.boolean().default(false),
  employmentType: z.enum(employmentTypeValues).optional(),

  descriptionHtml: z.string().min(1),
  descriptionText: z.string().optional(),
  skills: z.array(z.string().trim().min(1)).max(100).default([]),

  salaryMin: z.number().int().nonnegative().optional(),
  salaryMax: z.number().int().nonnegative().optional(),
  salaryCurrency: z.string().trim().length(3).optional(),
  salaryPeriod: z.enum(salaryPeriodValues).optional(),

  applyMethod: z.enum(applyMethodValues).default('external_ats'),
  applyEmail: z.string().email().optional(),

  postedAt: z.coerce.date().optional(),
  category: z.string().trim().max(200).optional(),
});

export type JobDto = z.infer<typeof jobDtoSchema>;

/** Raw data accepted by `SourceAdapter.normalize`. */
export type RawJob = Record<string, unknown>;
