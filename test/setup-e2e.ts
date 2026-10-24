import { execSync } from 'child_process';
import { vi } from 'vitest';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { MailService } from '../src/common/mail/mail.service';
import { S3_CLIENT } from '../src/modules/profiles/s3-client.provider';
import { createFakeS3Client } from './fixtures/fake-s3-client';

export interface TestContext {
  app: NestExpressApplication;
  pg: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  sendVerificationEmail: ReturnType<typeof vi.fn>;
}

export async function createTestApp(): Promise<TestContext> {
  const pg = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  const redis = await new RedisContainer('redis:7-alpine').start();

  const databaseUrl = pg.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  process.env.SESSION_SECRET = 'test-session-secret-0123456789';
  process.env.CSRF_SECRET = 'test-csrf-secret-0123456789';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.NODE_ENV = 'test';

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await client.end();

  execSync('pnpm drizzle-kit push --force', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  const sendVerificationEmail = vi.fn().mockResolvedValue(undefined);

  // Dynamic import deferred until after the env vars above are set: a
  // static top-level import would be hoisted ahead of this function body,
  // so app.module.ts's ConfigModule.forRoot() would validate against an
  // empty/stale environment instead of this test's Testcontainers values.
  const { AppModule } = await import('../src/app.module');
  const { configureApp } = await import('../src/bootstrap');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailService)
    .useValue({ sendVerificationEmail })
    .overrideProvider(S3_CLIENT)
    .useValue(createFakeS3Client())
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configureApp(app);
  await app.init();

  return { app, pg, redis, sendVerificationEmail };
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  await ctx.pg.stop();
  await ctx.redis.stop();
}

export function tokenFromVerifyUrl(url: string): string {
  return new URL(url).searchParams.get('token') ?? '';
}
