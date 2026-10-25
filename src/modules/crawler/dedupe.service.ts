import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Database } from '../../db/db.provider';
import { DRIZZLE } from '../../db/db.provider';
import { Job } from '../../db/schema';
import { normalizeText } from './crawler.utils';

/** Exact fingerprint first, then pg_trgm title similarity in the same company/30-day window. */
@Injectable()
export class DedupeService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findDuplicate(job: Job): Promise<string | null> {
    const title = normalizeText(job.title);
    const company = normalizeText(job.company);
    if (!title || !company) return null;

    const reference = job.postedAt ?? job.createdAt;
    const windowStart = new Date(reference.getTime() - 30 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(reference.getTime() + 30 * 24 * 60 * 60 * 1000);
    const normalizedCompany = sql`trim(regexp_replace(lower("company"), '[^a-z0-9]+', ' ', 'g'))`;
    const normalizedTitle = sql`trim(regexp_replace(lower("title"), '[^a-z0-9]+', ' ', 'g'))`;

    const result = (await this.db.execute(sql`
      select "id"
      from "jobs"
      where "id" <> ${job.id}
        and "is_active" = true
        and (
          "fingerprint" = ${job.fingerprint}
          or (
            ${normalizedCompany} = ${company}
            and coalesce("posted_at", "created_at") between ${windowStart} and ${windowEnd}
            and similarity(${normalizedTitle}, ${title}) > 0.9
          )
        )
      order by
        case when "fingerprint" = ${job.fingerprint} then 0 else 1 end,
        similarity(${normalizedTitle}, ${title}) desc,
        "created_at" asc
      limit 1
    `)) as unknown as { rows: Array<{ id: string }> };

    return result.rows[0]?.id ?? null;
  }
}
