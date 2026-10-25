import { Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import Redis from 'ioredis';
import {
  CRAWL_SOURCE_QUEUE,
  CRAWLER_REDIS,
  DEDUPE_QUEUE,
  ENRICH_JOB_QUEUE,
  MAINTENANCE_QUEUE,
  UPSERT_JOBS_QUEUE,
} from './crawler.constants';
import { CrawlerHttp } from './http';
import { AdapterRegistry } from './adapters/adapter.registry';
import { GreenhouseAdapter } from './adapters/greenhouse.adapter';
import { LeverAdapter } from './adapters/lever.adapter';
import { AshbyAdapter } from './adapters/ashby.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { ArbeitnowAdapter } from './adapters/arbeitnow.adapter';
import { JsonLdAdapter } from './adapters/jsonld.adapter';
import { HtmlAdapter } from './adapters/html.adapter';
import { CrawlerService } from './crawler.service';
import { DedupeService } from './dedupe.service';
import { CrawlSourceProcessor } from './crawl-source.processor';
import { UpsertJobsProcessor } from './upsert-jobs.processor';
import { DedupeProcessor } from './dedupe.processor';
import { EnrichJobProcessor } from './enrich-job.processor';
import { MaintenanceProcessor } from './maintenance.processor';
import { CrawlerScheduler } from './crawler.scheduler';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: CRAWL_SOURCE_QUEUE },
      { name: UPSERT_JOBS_QUEUE },
      { name: DEDUPE_QUEUE },
      { name: ENRICH_JOB_QUEUE },
      { name: MAINTENANCE_QUEUE },
    ),
  ],
  providers: [
    {
      provide: CRAWLER_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis =>
        new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379'),
    },
    CrawlerHttp,
    GreenhouseAdapter,
    LeverAdapter,
    AshbyAdapter,
    RemotiveAdapter,
    ArbeitnowAdapter,
    JsonLdAdapter,
    HtmlAdapter,
    AdapterRegistry,
    CrawlerService,
    DedupeService,
    CrawlSourceProcessor,
    UpsertJobsProcessor,
    DedupeProcessor,
    EnrichJobProcessor,
    MaintenanceProcessor,
    CrawlerScheduler,
  ],
  exports: [CrawlerService, AdapterRegistry, CrawlerScheduler],
})
export class CrawlerModule implements OnModuleDestroy {
  constructor(@Inject(CRAWLER_REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
