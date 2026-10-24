import { z } from 'zod';

export const jobTypeValues = ['full_time', 'part_time', 'contract', 'internship'] as const;

export const experienceSchema = z.object({
  company: z.string().trim().min(1, 'Company is required').max(200),
  title: z.string().trim().min(1, 'Title is required').max(200),
  location: z.string().trim().max(200).optional().or(z.literal('')),
  startDate: z.string().trim().optional().or(z.literal('')),
  endDate: z.string().trim().optional().or(z.literal('')),
  current: z.coerce.boolean().optional().default(false),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
});

export const educationSchema = z.object({
  school: z.string().trim().min(1, 'School is required').max(200),
  degree: z.string().trim().max(200).optional().or(z.literal('')),
  fieldOfStudy: z.string().trim().max(200).optional().or(z.literal('')),
  startDate: z.string().trim().optional().or(z.literal('')),
  endDate: z.string().trim().optional().or(z.literal('')),
  description: z.string().trim().max(4000).optional().or(z.literal('')),
});

export const skillSchema = z.object({
  name: z.string().trim().min(1, 'Skill name is required').max(80),
});

const commaList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => {
    const items = Array.isArray(value) ? value : value.split(',');
    return items.map((item) => item.trim()).filter(Boolean);
  })
  .default([]);

export const preferencesSchema = z.object({
  desiredTitles: commaList,
  locations: commaList,
  remote: z
    .union([z.literal('on'), z.literal('true'), z.boolean()])
    .optional()
    .transform((value) => value === 'on' || value === 'true' || value === true),
  salaryMin: z.coerce.number().int().nonnegative().optional(),
  salaryMax: z.coerce.number().int().nonnegative().optional(),
  salaryCurrency: z.string().trim().min(3).max(3).default('KES'),
  jobTypes: z
    .union([z.enum(jobTypeValues), z.array(z.enum(jobTypeValues))])
    .optional()
    .transform((value) => (Array.isArray(value) ? value : value ? [value] : [])),
});

export type ExperienceDto = z.infer<typeof experienceSchema>;
export type EducationDto = z.infer<typeof educationSchema>;
export type PreferencesDto = z.infer<typeof preferencesSchema>;
