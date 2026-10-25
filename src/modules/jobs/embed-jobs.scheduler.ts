import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { EMBED_JOBS_QUEUE } from './embed-jobs.processor';

@Injectable()
export class EmbedJobsScheduler {
  private readonly logger = new Logger(EmbedJobsScheduler.name);

  constructor(@InjectQueue(EMBED_JOBS_QUEUE) private readonly queue: Queue) {}

  @Cron('*/1 * * * *')
  async enqueue(): Promise<void> {
    await this.queue.add('embed-jobs', {}, { jobId: `embed-jobs-${Date.now()}`, removeOnComplete: true, removeOnFail: false });
    this.logger.debug('Enqueued embed-jobs batch');
  }
}
