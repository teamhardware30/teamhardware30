import { z } from 'zod';

export const jobTypeValues = ['full_time', 'part_time', 'contract', 'internship'] as const;
export const seniorityValues = ['intern', 'junior', 'mid', 'senior', 'lead', 'executive'] as const;

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Use a valid date')
  .optional()
  .or(z.literal(''));

export const experienceSchema = z
  .object({
    company: z.string().trim().min(1, 'Company is required').max(200),
    title: z.string().trim().min(1, 'Title is required').max(200),
    location: z.string().trim().max(200).optional().or(z.literal('')),
    startDate: optionalDate,
    endDate: optionalDate,
    current: z.coerce.boolean().optional().default(false),
    description: z.string().trim().max(4000).optional().or(z.literal('')),
  })
  .refine((value) => value.current || !value.endDate || !value.startDate || value.endDate >= value.startDate, {
    message: 'End date must be after the start date',
    path: ['endDate'],
  });

export const educationSchema = z
  .object({
    school: z.string().trim().min(1, 'School is required').max(200),
    degree: z.string().trim().max(200).optional().or(z.literal('')),
    fieldOfStudy: z.string().trim().max(200).optional().or(z.literal('')),
    startDate: optionalDate,
    endDate: optionalDate,
    description: z.string().trim().max(4000).optional().or(z.literal('')),
  })
  .refine((value) => !value.endDate || !value.startDate || value.endDate >= value.startDate, {
    message: 'End date must be after the start date',
    path: ['endDate'],
  });

export const skillSchema = z.object({
  name: z.string().trim().min(1, 'Skill name is required').max(80),
});

const commaList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => {
    const items = Array.isArray(value) ? value : value.split(',');
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  })
  .default([]);

const optionalNumber = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  z.coerce.number().int().nonnegative().optional(),
);

const currency = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, 'Use a three-letter ISO currency code')
  .transform((value) => value.toUpperCase())
  .default('KES');

export const preferencesSchema = z
  .object({
    desiredTitles: commaList.refine((items) => items.length > 0, 'Add at least one desired job title'),
    locations: commaList,
    remote: z
      .union([z.literal('on'), z.literal('true'), z.boolean()])
      .optional()
      .transform((value) => value === 'on' || value === 'true' || value === true),
    salaryMin: optionalNumber,
    salaryMax: optionalNumber,
    salaryCurrency: currency,
    jobTypes: z
      .union([z.enum(jobTypeValues), z.array(z.enum(jobTypeValues))])
      .optional()
      .transform((value) => (Array.isArray(value) ? value : value ? [value] : [])),
  })
  .refine((value) => value.salaryMin === undefined || value.salaryMax === undefined || value.salaryMin <= value.salaryMax, {
    message: 'Maximum salary must be greater than or equal to minimum salary',
    path: ['salaryMax'],
  });

export const profileDetailsSchema = z.object({
  headline: z.string().trim().max(200).optional().or(z.literal('')),
  summary: z.string().trim().max(5000).optional().or(z.literal('')),
  location: z.string().trim().max(200).optional().or(z.literal('')),
  yearsExperience: optionalNumber,
  seniority: z.enum(seniorityValues).optional().or(z.literal('')),
  openToRelocate: z
    .union([z.literal('on'), z.literal('true'), z.boolean()])
    .optional()
    .transform((value) => value === 'on' || value === 'true' || value === true),
});

export const resumeNameSchema = z.object({
  fileName: z.string().trim().min(1, 'Resume name is required').max(255),
});

export type ExperienceDto = z.infer<typeof experienceSchema>;
export type EducationDto = z.infer<typeof educationSchema>;
export type PreferencesDto = z.infer<typeof preferencesSchema>;
export type ProfileDetailsDto = z.infer<typeof profileDetailsSchema>;
