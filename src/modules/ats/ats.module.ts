import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { JobsModule } from '../jobs/jobs.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { AtsScanProcessor } from './ats-scan.processor';
import { AtsController } from './ats.controller';
import { AtsService, ATS_SCAN_QUEUE } from './ats.service';

const atsProcessors = process.env.WORKER === 'true' ? [AtsScanProcessor] : [];

@Module({
  imports: [ProfilesModule, JobsModule, AiModule, BullModule.registerQueue({ name: ATS_SCAN_QUEUE })],
  controllers: [AtsController],
  providers: [AtsService, ...atsProcessors],
  exports: [AtsService],
})
export class AtsModule {}
