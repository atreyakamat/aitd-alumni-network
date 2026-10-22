import { Request, Response, NextFunction } from 'express';
import redis from '../config/redis';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyGenerator?: (req: Request) => string;
}

export const cacheMiddleware = (options: CacheOptions = {}) => {
  const { ttl = 300, keyGenerator } = options; // Default 5 minutes

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache anonymous GET requests when a cache backend is configured
    if (!redis || req.method !== 'GET' || req.user) {
      return next();
    }

    const cacheKey = keyGenerator
      ? keyGenerator(req)
      : `cache:${req.originalUrl}`;

    try {
      const cached = await redis.get(cacheKey);

      if (cached) {
        return res.json(JSON.parse(cached));
      }

      // Override res.json to cache successful responses
      const originalJson = res.json.bind(res);
      res.json = (data: any) => {
        if (res.statusCode < 400) {
          redis.setex(cacheKey, ttl, JSON.stringify(data)).catch(() => undefined);
        }
        return originalJson(data);
      };

      next();
    } catch (error) {
      // If cache fails, continue without caching
      console.error('Cache error:', error);
      next();
    }
  };
};

export const invalidateCache = async (pattern: string) => {
  if (!redis) return;
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch (error) {
    console.error('Cache invalidation error:', error);
  }
};

export default cacheMiddleware;
