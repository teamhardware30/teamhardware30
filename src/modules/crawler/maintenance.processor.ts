import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CrawlerService } from './crawler.service';
import { DEACTIVATE_STALE_JOB, MAINTENANCE_QUEUE, STALE_AFTER_DAYS } from './crawler.constants';

@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(private readonly crawlerService: CrawlerService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== DEACTIVATE_STALE_JOB) {
      this.logger.warn(`Unknown maintenance job "${job.name}"`);
      return;
    }
    const count = await this.crawlerService.deactivateStaleJobs(STALE_AFTER_DAYS);
    this.logger.log(`Deactivated ${count} jobs not seen in ${STALE_AFTER_DAYS} days`);
  }
}
