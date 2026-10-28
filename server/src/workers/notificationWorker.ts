import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { NOTIFICATION_QUEUE, BROADCAST_JOB } from '../config/queue';
import { fanOutNotification, BroadcastPayload } from '../services/broadcastService';

/**
 * Starts the BullMQ worker that processes broadcast-notification jobs.
 * Returns null (a no-op) when Redis is not configured or under tests, matching
 * the optional-queue behaviour in config/queue.ts.
 */
export function startNotificationWorker(): Worker | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || process.env.NODE_ENV === 'test') return null;

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker(
    NOTIFICATION_QUEUE,
    async (job) => {
      if (job.name === BROADCAST_JOB) {
        const delivered = await fanOutNotification(job.data as BroadcastPayload);
        return { delivered };
      }
    },
    { connection, concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    console.error(`Notification job ${job?.id} failed:`, err.message);
  });
  worker.on('ready', () => console.log('✅ Notification worker ready'));

  return worker;
}
