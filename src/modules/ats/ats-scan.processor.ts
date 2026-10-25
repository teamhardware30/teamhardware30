import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AtsService, ATS_SCAN_QUEUE } from './ats.service';

@Processor(ATS_SCAN_QUEUE, { concurrency: 1 })
export class AtsScanProcessor extends WorkerHost {
  constructor(private readonly atsService: AtsService) {
    super();
  }

  async process(job: Job<{ userId: string; resumeId: string; jobId?: string }>): Promise<{ scanId: string }> {
    const scanId = await this.atsService.scan(job.data.userId, job.data.resumeId, job.data.jobId);
    return { scanId };
  }
}
