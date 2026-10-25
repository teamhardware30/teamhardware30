import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import * as schema from '../../db/schema';
import { sources, categories } from '../../db/schema';

const sourceSeedSchema = z.object({
  name: z.string().min(1),
  kind: z.enum(['greenhouse', 'lever', 'ashby', 'remotive', 'arbeitnow', 'jsonld', 'html']),
  baseUrl: z.string().url(),
  cron: z.string().min(1).default('0 */6 * * *'),
  enabled: z.boolean().default(false),
  killSwitch: z.boolean().default(false),
  config: z.record(z.unknown()).default({}),
});

const seedFileSchema = z.object({
  sources: z.array(sourceSeedSchema).min(1),
});

async function main(): Promise<void> {
  const file = join(process.cwd(), 'sources.yaml');
  const parsed = seedFileSchema.parse(parseYaml(readFileSync(file, 'utf8')));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/job_copilot',
  });
  const db = drizzle(pool, { schema });

  const categoryFile = join(process.cwd(), 'data', 'categories.json');
  const categorySeeds = z
    .array(z.object({ slug: z.string().min(1), name: z.string().min(1), parent: z.string().nullable() }))
    .parse(JSON.parse(readFileSync(categoryFile, 'utf8')));
  const categoryIdBySlug = new Map<string, string>();

  try {
    const orderedCategories = [...categorySeeds].sort((left, right) => (left.parent ? 1 : 0) - (right.parent ? 1 : 0));
    for (const seed of orderedCategories) {
      const existing = await db.query.categories.findFirst({ where: eq(categories.slug, seed.slug) });
      if (existing) {
        categoryIdBySlug.set(seed.slug, existing.id);
        continue;
      }
      const [category] = await db
        .insert(categories)
        .values({ slug: seed.slug, name: seed.name, parentId: seed.parent ? categoryIdBySlug.get(seed.parent) ?? null : null })
        .returning();
      categoryIdBySlug.set(seed.slug, category.id);
    }
    console.log(`Seeded categories: ${categoryIdBySlug.size}`);

    let created = 0;
    let updated = 0;
    for (const seed of parsed.sources) {
      const existing = await db.query.sources.findFirst({ where: eq(sources.name, seed.name) });
      if (existing) {
        await db
          .update(sources)
          .set({
            kind: seed.kind,
            baseUrl: seed.baseUrl,
            cron: seed.cron,
            enabled: seed.enabled,
            killSwitch: seed.killSwitch,
            config: seed.config,
            updatedAt: new Date(),
          })
          .where(eq(sources.id, existing.id));
        updated += 1;
      } else {
        await db.insert(sources).values({
          name: seed.name,
          kind: seed.kind,
          baseUrl: seed.baseUrl,
          cron: seed.cron,
          enabled: seed.enabled,
          killSwitch: seed.killSwitch,
          config: seed.config,
        });
        created += 1;
      }
    }
    console.log(`Seeded sources: ${created} created, ${updated} updated`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed to seed sources:', error);
  process.exitCode = 1;
});
