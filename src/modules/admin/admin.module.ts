import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrawlerModule } from '../crawler/crawler.module';
import { CRAWL_SOURCE_QUEUE } from '../crawler/crawler.constants';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [CrawlerModule, BullModule.registerQueue({ name: CRAWL_SOURCE_QUEUE })],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
