import { describe, expect, it } from 'vitest';
import { validateEnv } from '../src/common/config/env.schema';

const development = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/job_copilot',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'development-session-secret',
  CSRF_SECRET: 'development-csrf-secret',
};

describe('environment validation', () => {
  it('applies local defaults and transforms feature flags', () => {
    const config = validateEnv({ ...development, S3_FORCE_PATH_STYLE: 'true' });
    expect(config.PORT).toBe(3000);
    expect(config.EMBEDDING_DIMENSIONS).toBe(1024);
    expect(config.S3_FORCE_PATH_STYLE).toBe(true);
    expect(config.CRAWLER_RESPECT_ROBOTS).toBe(true);
  });

  it('rejects placeholder-length secrets', () => {
    expect(() => validateEnv({ ...development, SESSION_SECRET: 'change-me' })).toThrow('Invalid environment configuration');
  });

  it('requires production service credentials', () => {
    expect(() => validateEnv({ ...development, NODE_ENV: 'production' })).toThrow('SMTP_HOST');
  });

  it('accepts a complete production configuration', () => {
    const config = validateEnv({
      ...development,
      NODE_ENV: 'production',
      SMTP_HOST: 'smtp.example.com',
      ANTHROPIC_API_KEY: 'anthropic-key',
      EMBEDDING_API_KEY: 'embedding-key',
    });
    expect(config.NODE_ENV).toBe('production');
  });
});
