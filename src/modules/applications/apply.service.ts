import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import Redis from 'ioredis';
import { z } from 'zod';
import { MailService } from '../../common/mail/mail.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { DRIZZLE, Database } from '../../db/db.provider';
import { applications, matches, seekerProfiles } from '../../db/schema';
import { AiService } from '../ai/ai.service';
import { JobsService } from '../jobs/jobs.service';
import { ProfilesService } from '../profiles/profiles.service';
import { ResumeUploadService } from '../profiles/resume-upload.service';
import { UsersService } from '../users/users.service';

const coverLetterSchema = z.object({ subject: z.string(), body: z.string() });
const screeningSchema = z.object({ answers: z.array(z.object({ question: z.string(), answer: z.string().nullable(), needs_input: z.boolean() })) });

@Injectable()
export class ApplyService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly profilesService: ProfilesService,
    private readonly jobsService: JobsService,
    private readonly aiService: AiService,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly resumeUploadService: ResumeUploadService,
    private readonly config: ConfigService,
  ) {}

  async apply(profileId: string, jobId: string, input: { resumeId?: string; consent?: boolean; channel?: string }) {
    if (!input.consent) throw new Error('Explicit consent is required before applying');

    const [profile] = await this.db.select().from(seekerProfiles).where(eq(seekerProfiles.id, profileId));
    const job = await this.jobsService.findById(jobId);
    if (!profile || !job) throw new Error('Job not found');

    const match = await this.db.query.matches.findFirst({ where: and(eq(matches.profileId, profileId), eq(matches.jobId, jobId)) });
    if (!match || match.score < 50) throw new Error('A match score of at least 50 is required to apply');

    const existing = await this.db.query.applications.findFirst({ where: and(eq(applications.profileId, profileId), eq(applications.jobId, jobId)) });
    if (existing) throw new Error('You have already applied to this job');

    const dailyKey = `apply:daily:${profileId}:${new Date().toISOString().slice(0, 10)}`;
    const used = Number(await this.redis.get(dailyKey) ?? 0);
    if (used >= 25) throw new Error('Daily application limit reached');
    await this.redis.incr(dailyKey);
    await this.redis.expire(dailyKey, 86400);

    const resumesList = await this.profilesService.listResumes(profileId);
    const resume = input.resumeId ? resumesList.find((item) => item.id === input.resumeId) : resumesList.find((item) => item.isPrimary) ?? resumesList[0];
    if (!resume) throw new Error('Upload a resume before applying');

    const user = await this.usersService.findById(profile.userId);
    const replyTo = user?.email ?? 'seeker@example.com';

    if (job.applyMethod === 'onsite') {
      await this.db.insert(applications).values({ profileId, jobId, resumeId: resume.id, channel: 'onsite', status: 'submitted', submittedAt: new Date(), events: [{ type: 'submitted', at: new Date().toISOString() }] });
      if (job.applyEmail) {
        await this.mailService.sendApplicationEmail({ to: job.applyEmail, replyTo, subject: `Application: ${job.title}`, text: `Application from ${profile.headline ?? 'candidate'}` });
      }
      return { status: 'submitted', channel: 'onsite' };
    }

    if (job.applyMethod === 'email') {
      const coverLetter = await this.aiService.completeJson('cover_letter', {
        full_name: profile.headline ?? 'Candidate',
        job_title: job.title,
        company: job.company,
        tone: 'professional and warm',
        top_requirements: (job.requiredSkills ?? []).slice(0, 5).join(', '),
        availability: 'immediately',
        profile_json: JSON.stringify(profile),
        job_description: job.descriptionText,
      }, coverLetterSchema);
      const attachment = await this.resumeUploadService.download(resume.s3Key);
      const messageId = await this.mailService.sendApplicationEmail({
        to: job.applyEmail ?? 'jobs@example.com',
        replyTo,
        subject: coverLetter.subject,
        text: coverLetter.body,
        attachment,
        fileName: resume.fileName,
      });
      await this.db.insert(applications).values({ profileId, jobId, resumeId: resume.id, channel: 'email', status: 'submitted', coverLetter: coverLetter.body, submittedAt: new Date(), events: [{ type: 'submitted', at: new Date().toISOString(), messageId }] });
      return { status: 'submitted', channel: 'email', messageId };
    }

    const screening = await this.aiService.completeJson('screening_answers', {
      questions: 'why this role, why this company, notice period, salary expectation, work authorization, biggest relevant achievement',
      profile_json: JSON.stringify(profile),
      preferences_json: JSON.stringify({ desiredTitles: profile.desiredTitles, locations: profile.locations }),
    }, screeningSchema);
    await this.db.insert(applications).values({ profileId, jobId, resumeId: resume.id, channel: 'external_ats', status: 'draft', answers: screening, events: [{ type: 'created', at: new Date().toISOString() }] });
    return { status: 'draft', channel: 'external_ats', applyUrl: job.applyUrl };
  }

  async listApplications(profileId: string) {
    return this.db.query.applications.findMany({ where: eq(applications.profileId, profileId), with: { job: true, resume: true }, orderBy: (table, { desc }) => [desc(table.createdAt)] });
  }

  async updateStatus(profileId: string, applicationId: string, status: 'draft' | 'submitted' | 'failed' | 'viewed' | 'interview' | 'rejected' | 'offer') {
    await this.db.update(applications).set({ status, updatedAt: new Date() }).where(and(eq(applications.id, applicationId), eq(applications.profileId, profileId)));
  }
}
