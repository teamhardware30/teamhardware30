import { z } from 'zod';

function validDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const experienceStart = z
  .string()
  .trim()
  .transform((value) => {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (!match) return value;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] === undefined ? 1 : Number(match[3]);
    if (!validDate(year, month, day)) return value;
    return `${match[1]}-${match[2].padStart(2, '0')}`;
  })
  .refine((value) => value === null || /^\d{4}-\d{2}$/.test(value), 'Use a valid YYYY-MM date');

const experienceEnd = z
  .union([z.literal('present'), z.string()])
  .transform((value) => {
    if (value === 'present') return 'present';
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
    if (!match) return trimmed;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] === undefined ? 1 : Number(match[3]);
    if (!validDate(year, month, day)) return trimmed;
    return `${match[1]}-${match[2].padStart(2, '0')}`;
  })
  .refine((value) => value === null || value === 'present' || /^\d{4}-\d{2}$/.test(value), 'Use a valid YYYY-MM date or present');

const educationDate = z
  .string()
  .trim()
  .transform((value) => {
    if (!value) return null;
    const match = value.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
    if (!match) return value;
    if (match[2] === undefined) return match[1];
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] === undefined ? 1 : Number(match[3]);
    if (!validDate(year, month, day)) return value;
    return match[1];
  })
  .refine((value) => value === null || /^\d{4}$/.test(value), 'Use a valid year');

export const parsedResumeSchema = z.object({
  contact: z.object({
    full_name: z.string().trim().min(1).max(200),
    email: z.string().trim().email().nullable(),
    phone: z.string().trim().max(50).nullable(),
    location: z.string().trim().max(200).nullable(),
    links: z
      .array(z.string().trim().max(500))
      .default([])
      .transform((links) => {
        const normalized = links.map((link) => (/^https?:\/\//i.test(link) ? link : `https://${link}`));
        return [...new Set(normalized)];
      }),
  }),
  headline: z.string().trim().max(200).nullable(),
  summary: z.string().trim().max(4000).nullable(),
  experiences: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        company: z.string().trim().min(1).max(200),
        location: z.string().trim().max(200).nullable(),
        start: experienceStart,
        end: experienceEnd,
        bullets: z.array(z.string().trim().max(1000)).default([]),
      }).refine((value) => value.end === null || value.end === 'present' || !value.start || !value.end || value.end >= value.start, {
        message: 'End date must be after the start date',
        path: ['end'],
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string().trim().min(1).max(200),
        degree: z.string().trim().max(200).nullable(),
        field: z.string().trim().max(200).nullable(),
        start: educationDate,
        end: educationDate,
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        kind: z.enum(['hard', 'soft', 'tool', 'language']),
      }),
    )
    .max(40)
    .default([])
    .transform((skills) => {
      const seen = new Set<string>();
      return skills
        .map((skill) => ({ name: skill.name.trim(), kind: skill.kind }))
        .filter((skill) => {
          const key = skill.name.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    }),
  certifications: z.array(z.string().trim().max(200)).default([]),
  languages: z.array(z.string().trim().max(100)).default([]),
  total_years_experience: z.number().min(0).max(80).nullable(),
  seniority: z.enum(['intern', 'junior', 'mid', 'senior', 'lead', 'executive']).nullable(),
});

export type ParsedResume = z.infer<typeof parsedResumeSchema>;
