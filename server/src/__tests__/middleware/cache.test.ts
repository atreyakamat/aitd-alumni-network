type CacheModule = typeof import('../../middleware/cache');

const load = (redis: Record<string, jest.Mock> | null) => {
  let mod!: CacheModule;
  jest.isolateModules(() => {
    jest.doMock('../../config/redis', () => ({ __esModule: true, default: redis }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../../middleware/cache');
  });
  return mod;
};

const fakeRedis = () => ({
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
  keys: jest.fn().mockResolvedValue([]),
  del: jest.fn().mockResolvedValue(1),
});

const reqRes = (req: Record<string, unknown> = {}) => {
  const res: any = { statusCode: 200 };
  res.json = jest.fn().mockReturnValue(res);
  return { req: { method: 'GET', originalUrl: '/api/posts', ...req } as any, res, next: jest.fn() };
};

describe('cacheMiddleware', () => {
  it('never caches requests from signed-in members (responses carry viewer-specific state)', async () => {
    const redis = fakeRedis();
    const { cacheMiddleware } = load(redis);
    const { req, res, next } = reqRes({ user: { id: 'u1' } });

    await cacheMiddleware()(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
    res.json({ data: [{ isLiked: true }] });
    expect(redis.setex).not.toHaveBeenCalled();
  });

  it('serves anonymous GETs from cache and stores fresh successful responses', async () => {
    const redis = fakeRedis();
    const { cacheMiddleware } = load(redis);

    redis.get.mockResolvedValueOnce(JSON.stringify({ cached: true }));
    const hit = reqRes();
    await cacheMiddleware({ ttl: 60 })(hit.req, hit.res, hit.next);
    expect(hit.res.json).toHaveBeenCalledWith({ cached: true });
    expect(hit.next).not.toHaveBeenCalled();

    const miss = reqRes();
    await cacheMiddleware({ ttl: 60, keyGenerator: () => 'k' })(miss.req, miss.res, miss.next);
    miss.res.json({ fresh: true });
    expect(redis.setex).toHaveBeenCalledWith('k', 60, JSON.stringify({ fresh: true }));

    const failed = reqRes();
    await cacheMiddleware()(failed.req, failed.res, failed.next);
    failed.res.statusCode = 500;
    failed.res.json({ error: true });
    expect(redis.setex).toHaveBeenCalledTimes(1);
  });

  it('is a no-op without redis or for non-GET requests, and survives cache errors', async () => {
    const none = load(null);
    const a = reqRes();
    await none.cacheMiddleware()(a.req, a.res, a.next);
    expect(a.next).toHaveBeenCalled();

    const redis = fakeRedis();
    const { cacheMiddleware } = load(redis);
    const post = reqRes({ method: 'POST' });
    await cacheMiddleware()(post.req, post.res, post.next);
    expect(redis.get).not.toHaveBeenCalled();

    redis.get.mockRejectedValueOnce(new Error('down'));
    const broken = reqRes();
    await cacheMiddleware()(broken.req, broken.res, broken.next);
    expect(broken.next).toHaveBeenCalled();
  });
});

describe('invalidateCache', () => {
  it('deletes matching keys and tolerates errors or a missing backend', async () => {
    const redis = fakeRedis();
    const { invalidateCache } = load(redis);
    redis.keys.mockResolvedValueOnce(['cache:/api/posts?page=1']);
    await invalidateCache('cache:/api/posts*');
    expect(redis.del).toHaveBeenCalledWith('cache:/api/posts?page=1');

    await invalidateCache('nothing*');
    expect(redis.del).toHaveBeenCalledTimes(1);

    redis.keys.mockRejectedValueOnce(new Error('down'));
    await expect(invalidateCache('x')).resolves.toBeUndefined();
    await expect(load(null).invalidateCache('x')).resolves.toBeUndefined();
  });
});
