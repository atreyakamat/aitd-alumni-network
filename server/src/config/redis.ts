import Redis from 'ioredis';

/**
 * Redis is optional. When REDIS_URL is not configured the cache layer is a
 * no-op so the API degrades gracefully instead of retrying a missing server.
 */
const redisUrl = process.env.REDIS_URL;

export const redis: Redis | null = redisUrl && process.env.NODE_ENV !== 'test'
  ? new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    })
  : null;

if (redis) {
  redis.on('error', (err) => {
    console.error('Redis connection error:', err.message);
  });

  redis.on('connect', () => {
    console.log('✅ Connected to Redis');
  });
}

export default redis;
