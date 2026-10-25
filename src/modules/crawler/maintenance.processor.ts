import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  DEACTIVATE_STALE_JOB,
  LINK_CHECK_BATCH_SIZE,
  MAINTENANCE_QUEUE,
  STALE_AFTER_DAYS,
} from './crawler.constants';
import { CrawlerService } from './crawler.service';
import { CrawlerHttp } from './http';

@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly crawlerService: CrawlerService,
    private readonly http: CrawlerHttp,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== DEACTIVATE_STALE_JOB) {
      this.logger.warn(`Unknown maintenance job "${job.name}"`);
      return;
    }

    const now = new Date();
    const counts = await this.crawlerService.deactivateExpiredAndStaleJobs(now);
    this.logger.log(
      `Deactivated ${counts.expired} expired jobs and ${counts.stale} jobs not seen in ${STALE_AFTER_DAYS} days`,
    );

    const dueJobs = await this.crawlerService.listJobsDueForLinkCheck(now, LINK_CHECK_BATCH_SIZE);
    let dead = 0;
    for (const row of dueJobs) {
      if (!row.applyUrl) continue;
      let isDead = false;
      try {
        const source = row.sourceId ? await this.crawlerService.findSource(row.sourceId) : null;
        const configuredRate = source?.config.requestsPerSecond;
        const response = await this.http.head(row.applyUrl, {
          sourceId: row.sourceId ?? undefined,
          requestsPerSecond:
            typeof configuredRate === 'number' && Number.isFinite(configuredRate) && configuredRate > 0
              ? configuredRate
              : undefined,
        });
        isDead = response?.status === 404 || response?.status === 410;
      } catch (error) {
        // A timeout/403/5xx is not evidence that a posting is dead.
        this.logger.warn(`Could not check apply URL for job ${row.id}: ${(error as Error).message}`);
      }
      await this.crawlerService.recordLinkCheck(row.id, isDead, now);
      if (isDead) dead += 1;
    }
    this.logger.log(`Checked ${dueJobs.length} apply URLs; deactivated ${dead} dead links`);
  }
}
