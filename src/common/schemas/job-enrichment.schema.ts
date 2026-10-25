import { z } from 'zod';

export const seniorityValues = ['intern', 'junior', 'mid', 'senior', 'lead', 'executive'] as const;
export const employmentTypeValues = ['full_time', 'part_time', 'contract', 'internship', 'temporary'] as const;
export const remoteTypeValues = ['onsite', 'hybrid', 'remote'] as const;
export const educationLevelValues = ['none', 'diploma', 'bachelor', 'master', 'phd'] as const;

export function jobEnrichmentSchema(categorySlugs: string[]) {
  if (categorySlugs.length === 0) {
    throw new Error('At least one category slug is required');
  }
  return z.object({
    categorySlug: z.enum(categorySlugs as [string, ...string[]]),
    seniority: z.enum(seniorityValues),
    employmentType: z.enum(employmentTypeValues),
    remoteType: z.enum(remoteTypeValues),
    remoteRegions: z.array(z.string().trim().max(100)).default([]),
    requiredSkills: z.array(z.string().trim().min(1).max(80)).max(15).default([]),
    preferredSkills: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
    minYearsExperience: z.number().int().min(0).max(50).nullable(),
    educationLevel: z.enum(educationLevelValues).nullable(),
    salary: z.object({
      min: z.number().int().nonnegative().nullable(),
      max: z.number().int().nonnegative().nullable(),
      currency: z.string().trim().max(10).nullable(),
      period: z.enum(['year', 'month', 'hour']).nullable(),
    }),
    applyEmail: z.string().trim().email().nullable(),
    summary: z.string().trim().max(400).min(1),
  });
}

export type JobEnrichment = z.infer<ReturnType<typeof jobEnrichmentSchema>>;
