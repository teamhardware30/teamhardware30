import { BullModule } from '@nestjs/bullmq';
import { forwardRef } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { ComputeMatchesProcessor, COMPUTE_MATCHES_QUEUE } from './compute-matches.processor';
import { MatchExplanationService } from './explain.service';
import { MatchNewJobsProcessor, MATCH_NEW_JOBS_QUEUE } from './match-new-jobs.processor';
import { MatchesController } from './matches.controller';
import { MatchingService } from './matching.service';
import { RefreshMatchesScheduler } from './refresh-matches.scheduler';

const matchingProcessors = process.env.WORKER === 'true' ? [ComputeMatchesProcessor, MatchNewJobsProcessor, RefreshMatchesScheduler] : [];

@Module({
  imports: [
    forwardRef(() => ProfilesModule),
    AiModule,
    BullModule.registerQueue({ name: COMPUTE_MATCHES_QUEUE }, { name: MATCH_NEW_JOBS_QUEUE }),
  ],
  controllers: [MatchesController],
  providers: [MatchingService, MatchExplanationService, ...matchingProcessors],
  exports: [MatchingService, MatchExplanationService, BullModule],
})
export class MatchingModule {}
