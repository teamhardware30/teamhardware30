import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PING_QUEUE } from './ping.constants';

@Processor(PING_QUEUE)
export class PingProcessor extends WorkerHost {
  async process(job: Job<{ requestedAt?: string }>): Promise<{ pong: true; jobId?: string }> {
    return { pong: true, jobId: job.id };
  }
}
