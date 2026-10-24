import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.get<string>('REDIS_URL') ?? 'redis://localhost:6379');
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;

    const blockedTtl = await this.redis.pttl(blockKey);
    if (blockedTtl > 0) {
      return {
        totalHits: limit + 1,
        timeToExpire: 0,
        isBlocked: true,
        timeToBlockExpire: Math.ceil(blockedTtl / 1000),
      };
    }

    const totalHits = await this.redis.incr(hitKey);
    if (totalHits === 1) {
      await this.redis.pexpire(hitKey, ttl);
    }
    const hitTtl = await this.redis.pttl(hitKey);

    let isBlocked = false;
    let timeToBlockExpire = 0;
    if (totalHits > limit) {
      isBlocked = true;
      await this.redis.set(blockKey, '1', 'PX', blockDuration);
      timeToBlockExpire = Math.ceil(blockDuration / 1000);
    }

    return {
      totalHits,
      timeToExpire: Math.ceil(Math.max(hitTtl, 0) / 1000),
      isBlocked,
      timeToBlockExpire,
    };
  }
}
