import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { log } from '../utils/logger';

/**
 * Background job queue (BullMQ) for broadcast notifications.
 *
 * Like the cache layer, this is OPTIONAL: when REDIS_URL is not configured (or in
 * tests) the queue is null and callers fall back to doing the work inline. BullMQ
 * requires `maxRetriesPerRequest: null`, so it gets its own connection rather than
 * sharing the cache client in config/redis.ts.
 */
export const NOTIFICATION_QUEUE = 'notifications';
export const BROADCAST_JOB = 'broadcast';
export const DIGEST_QUEUE = 'digest';
export const DIGEST_TICK_JOB = 'digest-tick';

const redisUrl = process.env.REDIS_URL;
const queueEnabled = Boolean(redisUrl) && process.env.NODE_ENV !== 'test';

export const queueConnection = queueEnabled
  ? new IORedis(redisUrl as string, { maxRetriesPerRequest: null })
  : null;

export const notificationQueue: Queue | null = queueConnection
  ? new Queue(NOTIFICATION_QUEUE, { connection: queueConnection })
  : null;

export const digestQueue: Queue | null = queueConnection
  ? new Queue(DIGEST_QUEUE, { connection: queueConnection })
  : null;

if (notificationQueue) {
  // Connection errors repeat on every retry: the message is enough, a stack adds nothing
  notificationQueue.on('error', (err) => log.error('Notification queue error', { error: err.message }));
}
if (digestQueue) {
  digestQueue.on('error', (err) => log.error('Digest queue error', { error: err.message }));
}

export default notificationQueue;
