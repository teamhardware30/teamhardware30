import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { parsedResumeSchema } from '../../common/schemas/parsed-resume.schema';
import { DRIZZLE, Database } from '../../db/db.provider';
import { atsScans, jobs } from '../../db/schema';
import { AiService } from '../ai/ai.service';
import { JobsService } from '../jobs/jobs.service';
import { extractText } from '../profiles/extract-text';
import { ProfilesService } from '../profiles/profiles.service';
import { ResumeUploadService } from '../profiles/resume-upload.service';
import { runDeterministicChecks } from './checks';
import { analyzeKeywords, buildJobKeywords } from './keywords';

const atsReviewSchema = z.object({
  experience_relevance: z.number().min(0).max(100),
  relevance_reasoning: z.string().trim().max(500),
  missing_evidence: z.array(z.string().trim().max(200)).default([]),
  bullet_rewrites: z.array(z.object({ original: z.string(), improved: z.string(), why: z.string() })).default([]),
  summary_rewrite: z.string().trim().max(500),
});

export const ATS_SCAN_QUEUE = 'ats-scan';

@Injectable()
export class AtsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly profilesService: ProfilesService,
    private readonly jobsService: JobsService,
    private readonly aiService: AiService,
    private readonly resumeUploadService: ResumeUploadService,
    private readonly config: ConfigService,
    @InjectQueue(ATS_SCAN_QUEUE) private readonly scanQueue?: Queue,
  ) {}

  async enqueueScan(userId: string, resumeId: string, jobId?: string): Promise<string> {
    const profile = await this.profilesService.getOrCreateForUser(userId);
    const resumes = await this.profilesService.listResumes(profile.id);
    const resume = resumes.find((item) => item.id === resumeId);
    if (!resume) throw new Error('Resume not found');

    const jobIdForQueue = `ats-scan-${userId}-${resumeId}-${jobId ?? 'profile'}-${Date.now()}`;
    const job = await this.scanQueue?.add('scan', { userId, resumeId, jobId }, { jobId: jobIdForQueue, removeOnComplete: true, removeOnFail: false });
    return job?.id ?? jobIdForQueue;
  }

  async scan(userId: string, resumeId: string, jobId?: string): Promise<string> {
    const profile = await this.profilesService.getOrCreateForUser(userId);
    const resume = await this.profilesService.findResumeById(resumeId);
    if (!resume || resume.profileId !== profile.id) throw new Error('Resume not found');

    const buffer = await this.resumeUploadService.download(resume.s3Key);
    const extraction = await extractText(buffer, resume.mimeType);
    await this.profilesService.updateResumeParseResult(resume.id, { rawText: extraction.text });

    const job = jobId ? await this.jobsService.findById(jobId) : null;
    const keywords = job
      ? buildJobKeywords(job.requiredSkills ?? [], job.preferredSkills ?? [], job.descriptionText)
      : await this.commonSkills();
    const analysis = analyzeKeywords(keywords, extraction.text, job?.requiredSkills ?? []);

    const checks = runDeterministicChecks(resume.fileName, extraction);
    const keywordCoverage = keywords.length === 0 ? 1 : analysis.hits.length / keywords.length;
    const formatting = checks.filter((check) => check.passed).length / checks.length;
    const sections = checks.find((check) => check.id === 'standard-headings')?.passed ? 1 : 0.5;

    let relevance = 70;
    let missingEvidence: string[] = [];
    let bulletRewrites: Array<{ original: string; improved: string; why: string }> = [];
    let summaryRewrite = '';
    try {
      const review = await this.aiService.completeJson('ats_review', {
        job_title: job?.title ?? 'General role',
        company: job?.company ?? 'General',
        job_description: job?.descriptionText ?? 'No job description provided.',
        cv_text: extraction.text.slice(0, 12_000),
        keyword_hits: analysis.hits.map((hit) => hit.keyword).join(', '),
        keyword_gaps: analysis.gaps.join(', '),
      }, atsReviewSchema);
      relevance = review.experience_relevance;
      missingEvidence = review.missing_evidence ?? [];
      bulletRewrites = review.bullet_rewrites ?? [];
      summaryRewrite = review.summary_rewrite;
    } catch {
      // Deterministic results remain available if the LLM review fails.
    }

    const score = Math.round(keywordCoverage * 40 + relevance * 0.25 + formatting * 20 + sections * 15);

    const [scan] = await this.db
      .insert(atsScans)
      .values({
        profileId: profile.id,
        resumeId: resume.id,
        jobId: job?.id ?? null,
        score: Math.min(100, Math.max(0, score)),
        keywordHits: analysis.hits,
        keywordGaps: analysis.gaps.map((gap, index) => ({ keyword: gap, importance: index < (job?.requiredSkills?.length ?? 0) ? 'required' : 'preferred' })),
        formatIssues: checks.filter((check) => !check.passed),
        suggestions: [{ missingEvidence: missingEvidence ?? [], bulletRewrites: bulletRewrites ?? [], summaryRewrite: summaryRewrite ?? '', relevanceReasoning: '' }],
      } as never)
      .returning();

    return scan.id;
  }

  async getScan(scanId: string, profileId?: string) {
    const conditions = [eq(atsScans.id, scanId)];
    if (profileId) conditions.push(eq(atsScans.profileId, profileId));
    const [scan] = await this.db.select().from(atsScans).where(and(...conditions));
    return scan ?? null;
  }

  async tailor(scanId: string, userId: string): Promise<string> {
    const [scan] = await this.db.select().from(atsScans).where(eq(atsScans.id, scanId));
    if (!scan) throw new Error('Scan not found');
    const profile = await this.profilesService.getOrCreateForUser(userId);
    if (scan.profileId !== profile.id) throw new Error('Scan not found');
    const resume = await this.profilesService.findResumeById(scan.resumeId);
    if (!resume) throw new Error('Resume not found');

    const job = scan.jobId ? await this.jobsService.findById(scan.jobId) : null;
    const tailoredSchema = parsedResumeSchema.extend({ changes: z.array(z.string()).default([]) });
    const tailored = await this.aiService.completeJson('cv_tailor', {
      parsed_resume_json: resume.parsedJson ?? {},
      job_description: job?.descriptionText ?? '',
      keyword_gaps_supported: (scan.keywordGaps as Array<{ keyword: string }>).map((gap) => gap.keyword).join(', '),
    }, tailoredSchema as z.ZodType<z.infer<typeof tailoredSchema>>);

    const nunjucks = await import('nunjucks');
    const html = nunjucks.render('cv/ats_template.njk', { resume: tailored });
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    const uploaded = await this.resumeUploadService.uploadBuffer(pdf, userId, 'application/pdf', 'tailored-cv.pdf');
    const newResume = await this.profilesService.addResume(profile.id, {
      fileName: 'Tailored CV.pdf',
      ...uploaded,
      source: 'generated',
      parsedJson: tailored,
      parseStatus: 'done',
    });
    return newResume.id;
  }

  private async commonSkills(): Promise<string[]> {
    const rows = await this.db.select({ skills: jobs.requiredSkills }).from(jobs).where(eq(jobs.isActive, true)).limit(100);
    const counts = new Map<string, number>();
    for (const row of rows) for (const skill of row.skills ?? []) counts.set(skill, (counts.get(skill) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([skill]) => skill);
  }
}
