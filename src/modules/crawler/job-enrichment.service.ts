import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { jobEnrichmentSchema, type JobEnrichment } from '../../common/schemas/job-enrichment.schema';
import { DRIZZLE, Database } from '../../db/db.provider';
import { skills } from '../../db/schema';
import { AiService } from '../ai/ai.service';

@Injectable()
export class JobEnrichmentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly aiService: AiService,
    private readonly config: ConfigService,
  ) {}

  async enrich(input: { title: string; company: string; location: string | null; descriptionText: string }, categorySlugs: string[]): Promise<JobEnrichment> {
    const schema = jobEnrichmentSchema(categorySlugs);
    try {
      const enrichment = await this.aiService.completeJson(
        'job_enrich',
        {
          categorySlugs: categorySlugs.join(', '),
          title: input.title,
          company: input.company,
          location: input.location ?? '',
          description_text: input.descriptionText.slice(0, 8_000),
        },
        schema,
      );
      return {
        ...enrichment,
        remoteRegions: enrichment.remoteRegions ?? [],
        requiredSkills: await this.canonicalSkillNames(enrichment.requiredSkills ?? []),
        preferredSkills: await this.canonicalSkillNames(enrichment.preferredSkills ?? []),
      };
    } catch {
      return this.fallback(input, categorySlugs);
    }
  }

  private async canonicalSkillNames(names: string[]): Promise<string[]> {
    const result: string[] = [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const existing = await this.db.query.skills.findFirst({
        where: sql`lower(${skills.name}) = lower(${trimmed}) OR exists (select 1 from unnest(${skills.aliases}) as alias where lower(alias) = lower(${trimmed}))`,
      });
      if (existing) {
        result.push(existing.name);
      } else {
        const [skill] = await this.db.insert(skills).values({ name: trimmed, needsReview: true }).returning();
        result.push(skill.name);
      }
    }
    return [...new Set(result)];
  }

  private fallback(input: { title: string; company: string; location: string | null; descriptionText: string }, categorySlugs: string[]): JobEnrichment {
    const text = `${input.title} ${input.location ?? ''} ${input.descriptionText}`.toLowerCase();
    const categorySlug = this.fallbackCategory(text, categorySlugs);
    const remoteType = /\bremote\b/.test(text) ? 'remote' : /\bhybrid\b/.test(text) ? 'hybrid' : 'onsite';
    const employmentType = /\bcontract\b/.test(text)
      ? 'contract'
      : /\bintern(ship)?\b/.test(text)
        ? 'internship'
        : /\bpart[- ]time\b/.test(text)
          ? 'part_time'
          : 'full_time';
    const seniority = /\b(executive|director)\b/.test(text)
      ? 'executive'
      : /\blead\b/.test(text)
        ? 'lead'
        : /\bsenior\b/.test(text)
          ? 'senior'
          : /\bjunior\b/.test(text)
            ? 'junior'
            : /\bintern\b/.test(text)
              ? 'intern'
              : 'mid';
    const applyEmailMatch = input.descriptionText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return {
      categorySlug,
      seniority,
      employmentType,
      remoteType,
      remoteRegions: [],
      requiredSkills: [],
      preferredSkills: [],
      minYearsExperience: null,
      educationLevel: null,
      salary: { min: null, max: null, currency: null, period: null },
      applyEmail: applyEmailMatch?.[0] ?? null,
      summary: input.descriptionText.replace(/\s+/g, ' ').trim().slice(0, 240) || `${input.title} at ${input.company}`,
    };
  }

  private fallbackCategory(text: string, categorySlugs: string[]): string {
    const keywordMap: Array<[string, string[]]> = [
      ['engineering', ['engineer', 'developer', 'software', 'backend', 'frontend', 'devops']],
      ['data', ['data', 'analytics', 'scientist', 'machine learning']],
      ['product', ['product manager', 'product owner']],
      ['design', ['designer', 'ux', 'ui']],
      ['marketing', ['marketing', 'seo', 'content']],
      ['sales', ['sales', 'business development', 'account executive']],
      ['finance', ['finance', 'accountant', 'audit']],
      ['operations', ['operations', 'logistics', 'supply chain', 'project manager']],
      ['customer-success', ['customer success', 'support']],
      ['people', ['recruiter', 'human resources', 'hr']],
      ['legal', ['legal', 'compliance', 'counsel']],
      ['healthcare', ['nurse', 'clinical', 'health']],
      ['education', ['teacher', 'education', 'curriculum']],
      ['ngo-development', ['ngo', 'development', 'programs', 'monitoring and evaluation']],
    ];
    for (const [family, keywords] of keywordMap) {
      if (keywords.some((keyword) => text.includes(keyword)) && categorySlugs.includes(family)) return family;
    }
    return categorySlugs.includes('other') ? 'other' : categorySlugs[0];
  }
}
