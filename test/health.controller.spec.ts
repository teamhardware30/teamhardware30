import { Response } from 'express';
import type Redis from 'ioredis';
import { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/modules/health/health.controller';

describe('HealthController', () => {
  const query = vi.fn();
  const ping = vi.fn();
  const status = vi.fn();
  const json = vi.fn();
  let response: Response;

  beforeEach(() => {
    vi.clearAllMocks();
    response = { status, json } as unknown as Response;
    status.mockReturnValue(response);
  });

  function controller(): HealthController {
    return new HealthController({ query } as unknown as Pool, { ping, status: 'ready' } as unknown as Redis);
  }

  it('returns 200 when Postgres and Redis are available', async () => {
    query.mockResolvedValue({ rows: [] });
    ping.mockResolvedValue('PONG');

    await controller().check(response);

    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('returns 503 and identifies failed dependencies', async () => {
    query.mockRejectedValue(new Error('database unavailable'));
    ping.mockResolvedValue('PONG');

    await controller().check(response);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ status: 'unavailable', checks: { database: 'down', redis: 'up' } });
  });
});
