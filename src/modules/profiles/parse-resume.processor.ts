import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AiService } from '../ai/ai.service';
import { ProfilesService } from './profiles.service';
import { ResumeUploadService } from './resume-upload.service';
import { extractText } from './extract-text';
import { parseLinkedInZip } from './linkedin-import';
import { parsedResumeSchema } from '../../common/schemas/parsed-resume.schema';
import { EMBED_PROFILE_QUEUE } from './embed-profile.processor';

export const PARSE_RESUME_QUEUE = 'parse-resume';

const MAX_RESUME_TEXT_CHARS = 20_000;

export interface ParseResumeJobData {
  profileId: string;
  resumeId: string;
}

@Processor(PARSE_RESUME_QUEUE)
export class ParseResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(ParseResumeProcessor.name);

  constructor(
    private readonly profilesService: ProfilesService,
    private readonly resumeUploadService: ResumeUploadService,
    private readonly aiService: AiService,
    @InjectQueue(EMBED_PROFILE_QUEUE) private readonly embedProfileQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<ParseResumeJobData>): Promise<void> {
    const { profileId, resumeId } = job.data;
    this.logger.log(`Parsing resume ${resumeId} for profile ${profileId}`);

    try {
      const resume = await this.profilesService.findResumeById(resumeId);
      if (!resume) {
        throw new Error('Resume not found');
      }

      const buffer = await this.resumeUploadService.download(resume.s3Key);

      const parsed =
        resume.mimeType === 'application/zip'
          ? await parseLinkedInZip(buffer)
          : await this.parseWithAi(buffer, resume.mimeType);

      await this.profilesService.applyParsedResume(profileId, parsed);
      await this.embedProfileQueue.add('embed', { profileId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong while reading this file';
      this.logger.error(`Failed to parse resume ${resumeId}: ${message}`);
      await this.profilesService.setParseStatus(profileId, 'failed', message);
    }
  }

  private async parseWithAi(buffer: Buffer, mimeType: string) {
    const extracted = await extractText(buffer, mimeType);
    if (!extracted.text.trim()) {
      throw new Error(
        extracted.isScanned
          ? 'This looks like a scanned document and no readable text could be found, even with OCR.'
          : 'No readable text could be found in this file.',
      );
    }

    return this.aiService.completeJson(
      'cv_parse',
      { resumeText: extracted.text.slice(0, MAX_RESUME_TEXT_CHARS) },
      parsedResumeSchema,
    );
  }
}
