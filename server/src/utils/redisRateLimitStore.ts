import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import type Redis from 'ioredis';

/**
 * Rate-limit counters shared by every API instance through Redis.
 *
 * With the default in-memory store each process counts on its own, so the effective limit is multiplied by the number of
 * processes (PM2 cluster, several containers behind a load balancer). A shared counter keeps "10 login attempts per 15
 * minutes" meaning exactly that.
 *
 *  - One MULTI per hit: `SET key 0 PX window NX; INCR key; PTTL key`. SET..NX starts the window and gives the key its
 *    expiry in the same atomic step as the increment, so a crash can never leave a counter that lives forever. Should a
 *    key ever be found without an expiry anyway, it is given one.
 *  - Redis being unreachable must not switch the limits off, and must not take the API down with it: the hit is counted
 *    in this process's memory instead (the old behaviour) until Redis answers again.
 */
export class RedisRateLimitStore implements Store {
  /** Counters are shared between processes. */
  localKeys = false;
  readonly prefix: string;

  private windowMs = 15 * 60 * 1000;
  private readonly fallback = new MemoryStore();

  constructor(
    private readonly client: Redis,
    prefix: string
  ) {
    this.prefix = prefix;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  private keyFor(key: string) {
    return `${this.prefix}${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const redisKey = this.keyFor(key);
      const replies = await this.client.multi().set(redisKey, 0, 'PX', this.windowMs, 'NX').incr(redisKey).pttl(redisKey).exec();
      if (!replies) throw new Error('Redis returned no reply');
      for (const [error] of replies) if (error) throw error;

      const totalHits = Number(replies[1][1]);
      let ttl = Number(replies[2][1]);
      if (!(ttl > 0)) {
        await this.client.pexpire(redisKey, this.windowMs);
        ttl = this.windowMs;
      }
      return { totalHits, resetTime: new Date(Date.now() + ttl) };
    } catch {
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.client.multi().decr(this.keyFor(key)).exec();
    } catch {
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.client.del(this.keyFor(key));
    } catch {
      /* the local counter is reset below either way */
    }
    await this.fallback.resetKey(key);
  }

  shutdown(): void {
    this.fallback.shutdown();
  }
}
