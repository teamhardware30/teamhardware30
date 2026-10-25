import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, Database } from '../../db/db.provider';
import { Job } from '../../db/schema';
import { normalizeText } from './crawler.utils';

/**
 * Exact duplicates are caught by the unique fingerprint. This fallback catches
 * near-duplicates from the same company posted within the last 30 days.
 */
@Injectable()
export class DedupeService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findDuplicate(job: Job): Promise<string | null> {
    const title = normalizeText(job.title);
    const company = normalizeText(job.company);
    if (!title || !company) {
      return null;
    }

    const result = (await this.db.execute(sql`
      select "id"
      from "jobs"
      where "id" <> ${job.id}
        and "is_active" = true
        and lower("company") = ${company}
        and "created_at" > now() - interval '30 days'
        and similarity(lower("title"), ${title}) > 0.9
      order by similarity(lower("title"), ${title}) desc
      limit 1
    `)) as unknown as { rows: Array<{ id: string }> };

    return result.rows[0]?.id ?? null;
  }
}
