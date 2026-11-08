import { RedisRateLimitStore } from '../../utils/redisRateLimitStore';

/** The few Redis commands the store uses, with real expiry semantics. */
class FakeRedis {
  data = new Map<string, { value: number; expiresAt: number | null }>();
  now = 1_000_000;
  failing = false;
  calls: string[] = [];

  private live(key: string) {
    const entry = this.data.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.now) this.data.delete(key);
    return this.data.get(key);
  }

  multi() {
    const queue: Array<() => unknown> = [];
    const chain = {
      set: (key: string, value: number, _px: 'PX', ms: number, _nx: 'NX') => {
        queue.push(() => {
          this.calls.push('set');
          if (!this.live(key)) this.data.set(key, { value, expiresAt: this.now + ms });
          return 'OK';
        });
        return chain;
      },
      incr: (key: string) => {
        queue.push(() => {
          const entry = this.live(key) ?? { value: 0, expiresAt: null };
          entry.value += 1;
          this.data.set(key, entry);
          return entry.value;
        });
        return chain;
      },
      decr: (key: string) => {
        queue.push(() => {
          const entry = this.live(key);
          if (entry) entry.value -= 1;
          return entry?.value ?? 0;
        });
        return chain;
      },
      pttl: (key: string) => {
        queue.push(() => {
          const entry = this.live(key);
          if (!entry) return -2;
          return entry.expiresAt === null ? -1 : entry.expiresAt - this.now;
        });
        return chain;
      },
      exec: async () => {
        if (this.failing) throw new Error('Stream isn\'t writeable and enableOfflineQueue options is false');
        return queue.map((run) => [null, run()]);
      },
    };
    return chain;
  }

  async pexpire(key: string, ms: number) {
    const entry = this.live(key);
    if (entry) entry.expiresAt = this.now + ms;
    return entry ? 1 : 0;
  }

  async del(key: string) {
    if (this.failing) throw new Error('down');
    this.data.delete(key);
    return 1;
  }
}

const WINDOW = 15 * 60 * 1000;

const make = () => {
  const redis = new FakeRedis();
  const store = new RedisRateLimitStore(redis as never, 'rl:test:');
  store.init({ windowMs: WINDOW } as never);
  return { redis, store };
};

describe('RedisRateLimitStore', () => {
  it('counts hits per key and reports when the window ends', async () => {
    const { redis, store } = make();

    const first = await store.increment('1.2.3.4');
    const second = await store.increment('1.2.3.4');
    const other = await store.increment('5.6.7.8');

    expect(first.totalHits).toBe(1);
    expect(second.totalHits).toBe(2);
    expect(other.totalHits).toBe(1);
    const resetAt = second.resetTime?.getTime() ?? 0;
    expect(resetAt).toBeGreaterThan(Date.now() + WINDOW - 5000);
    expect(resetAt).toBeLessThanOrEqual(Date.now() + WINDOW + 5000);
    expect(redis.data.get('rl:test:1.2.3.4')?.expiresAt).toBe(redis.now + WINDOW);
  });

  it('namespaces keys so different limiters never share a counter', async () => {
    const redis = new FakeRedis();
    const a = new RedisRateLimitStore(redis as never, 'rl:login:');
    const b = new RedisRateLimitStore(redis as never, 'rl:search:');
    a.init({ windowMs: WINDOW } as never);
    b.init({ windowMs: WINDOW } as never);

    await a.increment('ip');
    await a.increment('ip');

    expect((await b.increment('ip')).totalHits).toBe(1);
    expect([...redis.data.keys()].sort()).toEqual(['rl:login:ip', 'rl:search:ip']);
  });

  it('starts a fresh window once the old one has expired', async () => {
    const { redis, store } = make();
    await store.increment('ip');
    await store.increment('ip');

    redis.now += WINDOW + 1;

    expect((await store.increment('ip')).totalHits).toBe(1);
  });

  it('never leaves a counter without an expiry (a crash between two commands cannot make a limit permanent)', async () => {
    const { redis, store } = make();
    // a key that exists without a TTL, e.g. left behind by an interrupted client
    redis.data.set('rl:test:stuck', { value: 41, expiresAt: null });

    const hit = await store.increment('stuck');

    expect(hit.totalHits).toBe(42);
    expect(redis.data.get('rl:test:stuck')?.expiresAt).not.toBeNull();
  });

  it('decrement and resetKey adjust the shared counter', async () => {
    const { store } = make();
    await store.increment('ip');
    await store.increment('ip');
    await store.decrement('ip');
    expect((await store.increment('ip')).totalHits).toBe(2);

    await store.resetKey('ip');
    expect((await store.increment('ip')).totalHits).toBe(1);
  });

  it('keeps limiting per process when Redis is down instead of switching the limit off', async () => {
    const { redis, store } = make();
    redis.failing = true;

    const hits = [];
    for (let i = 0; i < 3; i++) hits.push((await store.increment('ip')).totalHits);

    expect(hits).toEqual([1, 2, 3]);
  });

  it('uses the local counter only for the outage, and Redis again afterwards', async () => {
    const { redis, store } = make();
    redis.failing = true;
    await store.increment('ip');
    redis.failing = false;

    expect((await store.increment('ip')).totalHits).toBe(1);
    expect((await store.increment('ip')).totalHits).toBe(2);
  });
});
