import { z } from 'zod';

const dateLike = z.string().trim().min(1).max(20).nullable().optional().transform((v) => v || null);

export const parsedExperienceSchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  startDate: dateLike,
  endDate: dateLike,
  current: z.boolean().optional().default(false),
  description: z.string().trim().max(4000).nullable().optional().transform((v) => v || null),
});

export const parsedEducationSchema = z.object({
  school: z.string().trim().min(1).max(200),
  degree: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  fieldOfStudy: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  startDate: dateLike,
  endDate: dateLike,
  description: z.string().trim().max(4000).nullable().optional().transform((v) => v || null),
});

export const parsedResumeSchema = z.object({
  headline: z.string().trim().max(200).nullable().optional().transform((v) => v || null),
  summary: z.string().trim().max(2000).nullable().optional().transform((v) => v || null),
  experiences: z.array(parsedExperienceSchema).max(50).default([]),
  educations: z.array(parsedEducationSchema).max(50).default([]),
  skills: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
});

export type ParsedExperience = z.infer<typeof parsedExperienceSchema>;
export type ParsedEducation = z.infer<typeof parsedEducationSchema>;
export type ParsedResume = z.infer<typeof parsedResumeSchema>;
