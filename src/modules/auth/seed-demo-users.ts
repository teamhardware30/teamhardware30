import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { users, seekerProfiles } from '../../db/schema';
import { hashPassword } from './password.util';

const demoUsers = [
  { email: 'seeker@demo.jobcopilot.local', password: 'DemoSeeker123!', role: 'seeker', name: 'Demo Seeker' },
  { email: 'employer@demo.jobcopilot.local', password: 'DemoEmployer123!', role: 'employer', name: 'Demo Employer' },
  { email: 'admin@demo.jobcopilot.local', password: 'DemoAdmin123!', role: 'admin', name: 'Demo Admin' },
] as const;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/job_copilot' });
  const db = drizzle(pool, { schema });

  try {
    for (const demo of demoUsers) {
      const passwordHash = await hashPassword(demo.password);
      const existing = await db.query.users.findFirst({ where: eq(users.email, demo.email) });
      let userId: string;
      if (existing) {
        await db.update(users).set({ passwordHash, role: demo.role, name: demo.name, emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, existing.id));
        userId = existing.id;
      } else {
        const [user] = await db.insert(users).values({ email: demo.email, passwordHash, role: demo.role, name: demo.name, emailVerifiedAt: new Date() }).returning();
        userId = user.id;
      }

      if (demo.role === 'seeker') {
        const profile = await db.query.seekerProfiles.findFirst({ where: eq(seekerProfiles.userId, userId) });
        if (!profile) await db.insert(seekerProfiles).values({ userId, headline: 'Demo seeker profile', summary: 'A seeded account for demonstrations.' });
      }
      console.log(`Seeded demo ${demo.role}: ${demo.email}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Failed to seed demo users:', error);
  process.exitCode = 1;
});
