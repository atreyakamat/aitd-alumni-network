/**
 * With REDIS_URL set, the per-endpoint budgets are shared by every API process. Two apps built from the same code
 * stand in for two containers behind a load balancer: together they may allow 10 login attempts, not 10 each.
 */
import request from 'supertest';

/** The Redis commands the store uses, with expiry semantics. Shared by both "containers" below. */
class SharedFakeRedis {
  data = new Map<string, number>();
  multi() {
    const queue: Array<() => unknown> = [];
    const chain: any = {
      set: (key: string, value: number) => (queue.push(() => (this.data.has(key) ? null : (this.data.set(key, value), 'OK'))), chain),
      incr: (key: string) => (queue.push(() => this.data.set(key, (this.data.get(key) ?? 0) + 1).get(key)), chain),
      decr: (key: string) => (queue.push(() => this.data.set(key, (this.data.get(key) ?? 0) - 1).get(key)), chain),
      pttl: () => (queue.push(() => 900_000), chain),
      exec: async () => queue.map((run) => [null, run()]),
    };
    return chain;
  }
  async pexpire() {
    return 1;
  }
  async del(key: string) {
    this.data.delete(key);
    return 1;
  }
}

const shared = new SharedFakeRedis();
jest.mock('../../src/config/redis', () => ({ __esModule: true, default: shared, redis: shared }));

import { createApp } from '../../src/app';

describe('rate limits shared through Redis', () => {
  it('counts login attempts across two app instances', async () => {
    const containerA = createApp({ disableRateLimit: false });
    const containerB = createApp({ disableRateLimit: false });

    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await request(i % 2 === 0 ? containerA : containerB).post('/api/auth/login').send({});
      statuses.push(res.status);
    }

    // 10 allowed in total (400 = validation of the empty body), then refused by BOTH containers
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });

  it('keeps one counter per limiter: exhausting login does not spend the registration budget', async () => {
    const app = createApp({ disableRateLimit: false });
    const res = await request(app).post('/api/auth/register').send({});
    expect(res.status).not.toBe(429);
    const keys = [...shared.data.keys()];
    expect(keys.some((k) => k.startsWith('rl:auth:/api/auth/login:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('rl:auth:/api/auth/register:'))).toBe(true);
  });
});
