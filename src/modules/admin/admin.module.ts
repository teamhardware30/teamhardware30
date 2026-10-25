import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CRAWL_SOURCE_QUEUE, ENRICH_JOB_QUEUE } from '../crawler/crawler.constants';
import { CrawlerModule } from '../crawler/crawler.module';
import { JobsModule } from '../jobs/jobs.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [CrawlerModule, JobsModule, BullModule.registerQueue({ name: CRAWL_SOURCE_QUEUE }, { name: ENRICH_JOB_QUEUE })],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
