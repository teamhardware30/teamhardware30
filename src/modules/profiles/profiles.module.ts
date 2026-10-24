import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MulterModule } from '@nestjs/platform-express';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { ResumeUploadService, MAX_RESUME_SIZE_BYTES } from './resume-upload.service';
import { ParseResumeProcessor, PARSE_RESUME_QUEUE } from './parse-resume.processor';
import { EmbedProfileProcessor, EMBED_PROFILE_QUEUE } from './embed-profile.processor';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    AiModule,
    BullModule.registerQueue({ name: PARSE_RESUME_QUEUE }, { name: EMBED_PROFILE_QUEUE }),
    MulterModule.register({ limits: { fileSize: MAX_RESUME_SIZE_BYTES } }),
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService, ResumeUploadService, ParseResumeProcessor, EmbedProfileProcessor],
  exports: [ProfilesService],
})
export class ProfilesModule {}
