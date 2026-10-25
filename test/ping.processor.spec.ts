import { Job } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { PingProcessor } from '../src/common/queues/ping.processor';

describe('PingProcessor', () => {
  it('processes a ping job', async () => {
    const result = await new PingProcessor().process({ id: 'ping-1' } as Job);
    expect(result).toEqual({ pong: true, jobId: 'ping-1' });
  });
});
