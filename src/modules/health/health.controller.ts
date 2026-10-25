import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import type Redis from 'ioredis';
import { Pool } from 'pg';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { PG_POOL } from '../../db/db.provider';

@Controller()
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get(['healthz', 'api/v1/healthz'])
  async check(@Res() res: Response): Promise<void> {
    const [database, redis] = await Promise.all([
      this.runCheck(() => this.pool.query('SELECT 1')),
      this.runCheck(async () => {
        if (this.redis.status === 'wait') await this.redis.connect();
        return this.redis.ping();
      }),
    ]);
    const healthy = database.ok && redis.ok;

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({
      status: healthy ? 'ok' : 'unavailable',
      checks: {
        database: database.ok ? 'up' : 'down',
        redis: redis.ok ? 'up' : 'down',
      },
    });
  }

  private async runCheck(check: () => Promise<unknown>): Promise<{ ok: boolean }> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Health check timed out')), 2_000);
          timeout.unref();
        }),
      ]);
      return { ok: true };
    } catch {
      return { ok: false };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
