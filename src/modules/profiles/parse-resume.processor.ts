import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { z } from 'zod';
import { parsedResumeSchema } from '../../common/schemas/parsed-resume.schema';
import { scanBufferForMalware } from '../../common/security/malware-scan';
import { AiService } from '../ai/ai.service';
import { extractText, ExtractedText as ExtractedDocument } from './extract-text';
import { parseLinkedInZip } from './linkedin-import';
import { EMBED_PROFILE_QUEUE, PARSE_RESUME_QUEUE } from './profiles.constants';
import { ProfilesService } from './profiles.service';
import { ResumeUploadService } from './resume-upload.service';

export { ExtractedDocument };
export { PARSE_RESUME_QUEUE } from './profiles.constants';

const MAX_LLM_TEXT_CHARS = 20_000;

@Processor(PARSE_RESUME_QUEUE, { concurrency: 1 })
export class ParseResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(ParseResumeProcessor.name);

  constructor(
    @Inject(ProfilesService) private readonly profilesService: ProfilesService,
    @Inject(ResumeUploadService) private readonly resumeUploadService: ResumeUploadService,
    @Inject(AiService) private readonly aiService: AiService,
    @InjectQueue(EMBED_PROFILE_QUEUE) private readonly embedProfileQueue: { add: (name: string, data: unknown, options?: unknown) => Promise<unknown> },
  ) {
    super();
  }

  async process(job: Job<{ profileId: string; resumeId: string }>): Promise<void> {
    const { profileId, resumeId } = job.data;
    const resume = await this.profilesService.findResumeById(resumeId);
    if (!resume || resume.profileId !== profileId) {
      await this.setFailed(profileId, resumeId, 'The uploaded resume could not be found. Upload it again and retry.');
      throw new Error('The uploaded resume could not be found. Upload it again and retry.');
    }

    await this.profilesService.setParseStatus(profileId, 'processing');

    try {
      const buffer = await this.resumeUploadService.download(resume.s3Key);
      scanBufferForMalware(buffer);
      let parsed: z.infer<typeof parsedResumeSchema>;

      if (resume.mimeType === 'application/zip' || resume.fileName?.toLowerCase().endsWith('.zip')) {
        parsed = await parseLinkedInZip(buffer);
      } else {
        const extracted = await extractText(buffer, resume.mimeType);
        await this.profilesService.saveResumeRawText(profileId, resumeId, extracted.text);
        if (extracted.isScanned && extracted.text.trim().length < 200) {
          throw new Error('This looks like a scanned document and no readable text could be found, even with OCR.');
        }
        parsed = await this.aiService.completeJson('cv_parse', { cv_text: extracted.text.slice(0, MAX_LLM_TEXT_CHARS) }, parsedResumeSchema as z.ZodType<z.infer<typeof parsedResumeSchema>>);
      }

      await this.profilesService.applyParsedResume(profileId, parsed, resumeId);
      await this.profilesService.setParseStatus(profileId, 'done');
      await this.embedProfileQueue.add('embed', { profileId }, { jobId: `embed-profile-${profileId}`, delay: 60_000, attempts: 4, removeOnComplete: true });
    } catch (error) {
      const original = error instanceof Error ? error : new Error('We could not parse this resume. Please try again or upload a different file.');
      const friendly = original.message.includes('secret provider diagnostics')
        ? 'We could not parse this resume. Please try again or upload a different file.'
        : original.message.includes('scanned')
          ? original.message
          : original.message.includes('could not be found')
            ? original.message
            : 'We could not parse this resume. Please try again or upload a different file.';

      try {
        const updater = (this.profilesService as { updateResumeParseResult?: (id: string, data: { parseStatus: string; parseError: string }) => Promise<void> }).updateResumeParseResult;
        if (updater) await updater(resumeId, { parseStatus: 'failed', parseError: friendly });
      } catch {
        // Preserve the original processing error if the status update fails.
      }
      try {
        await this.profilesService.setParseStatus(profileId, 'failed', friendly);
      } catch {
        // Preserve the original processing error if the status update fails.
      }
      throw original;
    }
  }

  private async setFailed(profileId: string, resumeId: string, message: string): Promise<void> {
    const updater = (this.profilesService as { updateResumeParseResult?: (id: string, data: { parseStatus: string; parseError: string }) => Promise<void> }).updateResumeParseResult;
    try {
      if (updater) await updater(resumeId, { parseStatus: 'failed', parseError: message });
    } catch {
      // Preserve the original processing error if the status update fails.
    }
    try {
      await this.profilesService.setParseStatus(profileId, 'failed', message);
    } catch {
      // Preserve the original processing error if the status update fails.
    }
  }
}
