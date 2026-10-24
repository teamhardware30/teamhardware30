import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MulterModule } from '@nestjs/platform-express';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { ResumeUploadService } from './resume-upload.service';
import { ParseResumeProcessor, PARSE_RESUME_QUEUE } from './parse-resume.processor';
import { MAX_RESUME_SIZE_BYTES } from './resume-upload.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: PARSE_RESUME_QUEUE }),
    MulterModule.register({ limits: { fileSize: MAX_RESUME_SIZE_BYTES } }),
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService, ResumeUploadService, ParseResumeProcessor],
  exports: [ProfilesService],
})
export class ProfilesModule {}
