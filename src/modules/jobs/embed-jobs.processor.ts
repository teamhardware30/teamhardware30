import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { eq, isNull } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { categories, jobs } from '../../db/schema';
import { AiService } from '../ai/ai.service';

export const EMBED_JOBS_QUEUE = 'embed-jobs';

@Processor(EMBED_JOBS_QUEUE, { concurrency: 1 })
export class EmbedJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbedJobsProcessor.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly aiService: AiService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const rows = await this.db.select().from(jobs).where(isNull(jobs.embedding)).limit(64);
    if (rows.length === 0) return;

    const categoryMap = new Map((await this.db.select().from(categories)).map((category) => [category.id, category.name]));
    const texts = rows.map((job) => [job.title, job.categoryId ? categoryMap.get(job.categoryId) : '', job.requiredSkills.join(', '), job.descriptionText.slice(0, 1500)].filter(Boolean).join('\n'));

    const vectors = await this.aiService.embed(texts);
    await this.db.transaction(async (tx) => {
      for (const [index, row] of rows.entries()) {
        await tx.update(jobs).set({ embedding: vectors[index], updatedAt: new Date() }).where(eq(jobs.id, row.id));
      }
    });
    this.logger.log(`Embedded ${rows.length} jobs`);
  }
}
