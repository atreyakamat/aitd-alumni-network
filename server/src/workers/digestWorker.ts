import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { DIGEST_QUEUE, DIGEST_TICK_JOB, digestQueue } from '../config/queue';
import { digestService } from '../services/digestService';
import { log } from '../utils/logger';

/**
 * Hourly tick that sends the weekly digest when the admin-configured day/hour matches
 * (digestService.runIfDue dedupes to once per week). No-op without Redis — the admin can
 * still "send now" from the panel. Returns the worker so it can be closed on shutdown.
 */
export function startDigestWorker(): Worker | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl || process.env.NODE_ENV === 'test' || !digestQueue) return null;

  // Schedule an hourly repeatable tick (idempotent: same jobId/pattern replaces the old one).
  digestQueue
    .add(DIGEST_TICK_JOB, {}, { repeat: { pattern: '0 * * * *' }, jobId: 'digest-hourly-tick', removeOnComplete: true, removeOnFail: 50 })
    .catch((err) => log.error('Could not schedule digest tick', { err }));

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker(
    DIGEST_QUEUE,
    async () => {
      const result = await digestService.runIfDue();
      if (result.ran) log.info('Weekly digest sent', { sent: result.sent });
      return result;
    },
    { connection, concurrency: 1 }
  );
  worker.on('failed', (job, err) => log.error('Digest job failed', { jobId: job?.id, err }));
  worker.on('ready', () => log.info('Digest worker ready'));
  return worker;
}
