import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { EmbedJobsProcessor, EMBED_JOBS_QUEUE } from './embed-jobs.processor';
import { EmbedJobsScheduler } from './embed-jobs.scheduler';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { SitemapController } from './sitemap.controller';

const jobProcessors = process.env.WORKER === 'true' ? [EmbedJobsProcessor, EmbedJobsScheduler] : [];

@Module({
  imports: [AiModule, BullModule.registerQueue({ name: EMBED_JOBS_QUEUE })],
  controllers: [JobsController, SitemapController],
  providers: [JobsService, ...jobProcessors],
  exports: [JobsService],
})
export class JobsModule {}
