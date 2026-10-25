import { BullModule } from '@nestjs/bullmq';
import { Module, Inject } from '@nestjs/common';
import { OnModuleDestroy} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AiModule } from '../ai/ai.module';
import { AdapterRegistry } from './adapters/adapter.registry';
import { ArbeitnowAdapter } from './adapters/arbeitnow.adapter';
import { AshbyAdapter } from './adapters/ashby.adapter';
import { GreenhouseAdapter } from './adapters/greenhouse.adapter';
import { HtmlAdapter } from './adapters/html.adapter';
import { JsonLdAdapter } from './adapters/jsonld.adapter';
import { LeverAdapter } from './adapters/lever.adapter';
import { RemotiveAdapter } from './adapters/remotive.adapter';
import { CrawlSourceProcessor } from './crawl-source.processor';
import {
  CRAWL_SOURCE_QUEUE,
  CRAWLER_REDIS,
  DEDUPE_QUEUE,
  ENRICH_JOB_QUEUE,
  MAINTENANCE_QUEUE,
  UPSERT_JOBS_QUEUE,
} from './crawler.constants';
import { CrawlerScheduler } from './crawler.scheduler';
import { CrawlerService } from './crawler.service';
import { DedupeProcessor } from './dedupe.processor';
import { DedupeService } from './dedupe.service';
import { EnrichJobProcessor } from './enrich-job.processor';
import { CrawlerHttp } from './http';
import { JobEnrichmentService } from './job-enrichment.service';
import { MaintenanceProcessor } from './maintenance.processor';
import { UpsertJobsProcessor } from './upsert-jobs.processor';

const crawlerProcessors = process.env.WORKER === 'true'
  ? [CrawlSourceProcessor, UpsertJobsProcessor, DedupeProcessor, EnrichJobProcessor, MaintenanceProcessor]
  : [];

@Module({
  imports: [
    AiModule,
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
    JobEnrichmentService,
    CrawlerScheduler,
    ...crawlerProcessors,
  ],
  exports: [CrawlerService, AdapterRegistry, CrawlerScheduler],
})
export class CrawlerModule implements OnModuleDestroy {
  constructor(@Inject(CRAWLER_REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
