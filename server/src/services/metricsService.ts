import prisma from '../config/database';
import redis from '../config/redis';
import { getKafka, kafkaStatus, readKafkaSettings } from '../config/kafka';
import { readQueueBacklog } from './deadLetterService';
import { requestCounts, type MetricsSnapshot } from '../utils/metrics';

const OVERDUE_DAYS = 7;
const CACHE_MS = 15_000;

let cached: { at: number; value: Pick<MetricsSnapshot, 'deadLetters' | 'consumerLag' | 'pendingRegistrations' | 'overdueRegistrations'> } | undefined;

/** The expensive parts (broker and database counts) are cached for 15 s, so a scraper cannot hammer them. */
const slow = async () => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const settings = readKafkaSettings();
  const [backlog, pending, overdue] = await Promise.all([
    settings.enabled ? readQueueBacklog(getKafka(settings), settings).catch(() => null) : Promise.resolve(null),
    prisma.user.count({ where: { approvalStatus: 'PENDING' } }).catch(() => null),
    prisma.user.count({ where: { approvalStatus: 'PENDING', createdAt: { lt: new Date(Date.now() - OVERDUE_DAYS * 86_400_000) } } }).catch(() => null),
  ]);
  const value = { deadLetters: backlog?.deadLetters ?? null, consumerLag: backlog?.lag ?? null, pendingRegistrations: pending, overdueRegistrations: overdue };
  cached = { at: Date.now(), value };
  return value;
};

export const buildMetricsSnapshot = async (): Promise<MetricsSnapshot> => {
  const databaseUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
  return {
    uptimeSeconds: process.uptime(),
    requests: requestCounts(),
    databaseUp,
    redis: redis ? (redis.status === 'ready' ? 'up' : 'down') : 'disabled',
    kafka: kafkaStatus(),
    ...(await slow()),
  };
};
