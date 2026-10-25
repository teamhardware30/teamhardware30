import { InjectQueue } from '@nestjs/bullmq';
import { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  CRAWL_SOURCE_JOB,
  CRAWL_SOURCE_QUEUE,
  DEACTIVATE_STALE_JOB,
  MAINTENANCE_QUEUE,
} from './crawler.constants';
import { CrawlerService } from './crawler.service';

export interface CrawlSourceJobData {
  sourceId: string;
  force?: boolean;
}

/**
 * Registers one BullMQ job scheduler per enabled source, plus the nightly
 * stale-job cleanup. Only the worker process runs this (WORKER=true), so the
 * web process never owns repeatable jobs.
 */
@Injectable()
export class CrawlerScheduler implements OnModuleInit {
  private readonly logger = new Logger(CrawlerScheduler.name);

  constructor(
    private readonly crawlerService: CrawlerService,
    @InjectQueue(CRAWL_SOURCE_QUEUE) private readonly crawlQueue: Queue<CrawlSourceJobData>,
    @InjectQueue(MAINTENANCE_QUEUE) private readonly maintenanceQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.WORKER !== 'true') {
      return;
    }
    await this.syncSchedulers();
    await this.maintenanceQueue.upsertJobScheduler(
      DEACTIVATE_STALE_JOB,
      { pattern: '0 3 * * *' },
      { name: DEACTIVATE_STALE_JOB, data: {} },
    );
  }

  async syncSchedulers(): Promise<void> {
    const sources = await this.crawlerService.listEnabledSources();
    const desired = new Set(sources.map((source) => `source-${source.id}`));

    for (const source of sources) {
      try {
        await this.crawlQueue.upsertJobScheduler(
          `source-${source.id}`,
          { pattern: source.cron },
          { name: CRAWL_SOURCE_JOB, data: { sourceId: source.id } },
        );
      } catch (error) {
        this.logger.error(`Invalid cron "${source.cron}" for source ${source.name}: ${(error as Error).message}`);
      }
    }

    try {
      const existing = await this.crawlQueue.getJobSchedulers(0, -1, true);
      for (const scheduler of existing) {
        if (scheduler.id?.startsWith('source-') && !desired.has(scheduler.id)) {
          await this.crawlQueue.removeJobScheduler(scheduler.id);
          this.logger.log(`Removed scheduler for deleted/disabled source ${scheduler.id}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Could not prune old source schedulers: ${(error as Error).message}`);
    }
  }
}
