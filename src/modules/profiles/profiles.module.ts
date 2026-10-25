import { BullModule } from '@nestjs/bullmq';
import { forwardRef } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AiModule } from '../ai/ai.module';
import { MatchingModule } from '../matching/matching.module';
import { EmbedProfileProcessor } from './embed-profile.processor';
import { ParseResumeProcessor } from './parse-resume.processor';
import { EMBED_PROFILE_QUEUE, PARSE_RESUME_QUEUE } from './profiles.constants';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { ResumeUploadService, MAX_RESUME_SIZE_BYTES } from './resume-upload.service';
import { s3ClientProvider } from './s3-client.provider';

const profileProcessors = process.env.WORKER === 'true' ? [ParseResumeProcessor, EmbedProfileProcessor] : [];

@Module({
  imports: [
    AiModule,
    forwardRef(() => MatchingModule),
    BullModule.registerQueue({ name: PARSE_RESUME_QUEUE }, { name: EMBED_PROFILE_QUEUE }),
    MulterModule.register({ limits: { fileSize: MAX_RESUME_SIZE_BYTES } }),
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService, ResumeUploadService, s3ClientProvider, ...profileProcessors],
  exports: [ProfilesService, ResumeUploadService],
})
export class ProfilesModule {}
