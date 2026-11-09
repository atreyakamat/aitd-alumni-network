import Redis from 'ioredis';
import { log } from '../utils/logger';

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
    // Fires on every reconnect attempt: the message is enough, a stack adds nothing
    log.error('Redis connection error', { error: err.message });
  });

  redis.on('connect', () => {
    log.info('Connected to Redis');
  });
}

export default redis;
