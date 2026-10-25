import { z } from 'zod';

const booleanValue = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_URL: z.string().url().default('http://localhost:3000'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: booleanValue.default('false'),
    SENTRY_DSN: z.string().optional(),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    SESSION_SECRET: z.string().min(16),
    CSRF_SECRET: z.string().min(16),

    LINKEDIN_CLIENT_ID: z.string().optional(),
    LINKEDIN_CLIENT_SECRET: z.string().optional(),
    LINKEDIN_CALLBACK_URL: z.string().optional(),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CALLBACK_URL: z.string().optional(),

    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-sonnet-4-5'),

    EMBEDDING_PROVIDER: z.enum(['voyage', 'none']).default('voyage'),
    EMBEDDING_API_KEY: z.string().optional(),
    EMBEDDING_MODEL: z.string().default('voyage-2'),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1024),

    AWS_REGION: z.string().default('us-east-1'),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET: z.string().default('job-copilot-uploads'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: booleanValue.default('false'),
    RESUME_MAX_PAGES: z.coerce.number().int().positive().max(100).default(20),
    RESUME_PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('no-reply@job-copilot.local'),

    APPLY_DAILY_LIMIT: z.coerce.number().int().positive().default(25),
    SCAN_DAILY_LIMIT: z.coerce.number().int().positive().default(20),

    CRAWLER_CONTACT_EMAIL: z.string().email().default('crawler@job-copilot.local'),
    CRAWLER_REQUESTS_PER_SECOND: z.coerce.number().positive().default(1),
    CRAWLER_RESPECT_ROBOTS: booleanValue.default('true'),
    CRAWLER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    CRAWLER_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    CLAMAV_REQUIRED: booleanValue.default('false'),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV !== 'production') return;

    const required: Array<[keyof typeof config, boolean, string]> = [
      ['SMTP_HOST', Boolean(config.SMTP_HOST), 'SMTP_HOST is required in production'],
      ['S3_BUCKET', Boolean(config.S3_BUCKET), 'S3_BUCKET is required in production'],
      ['ANTHROPIC_API_KEY', Boolean(config.ANTHROPIC_API_KEY), 'ANTHROPIC_API_KEY is required in production'],
    ];

    if (config.SESSION_SECRET.toLowerCase().includes('change-me') || config.CSRF_SECRET.toLowerCase().includes('change-me')) {
      context.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'SESSION_SECRET and CSRF_SECRET must not use placeholder values in production' });
    }

    if (config.EMBEDDING_PROVIDER === 'voyage') {
      required.push([
        'EMBEDDING_API_KEY',
        Boolean(config.EMBEDDING_API_KEY),
        'EMBEDDING_API_KEY is required when EMBEDDING_PROVIDER=voyage in production',
      ]);
    }

    for (const [path, valid, message] of required) {
      if (!valid) context.addIssue({ code: 'custom', path: [path], message });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
