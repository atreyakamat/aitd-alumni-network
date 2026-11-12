import crypto from 'crypto';
import type { Kafka } from 'kafkajs';
import type { KafkaSettings } from '../config/kafka';
import { parseEnvelope } from './notificationEvents';

/**
 * Looking at and dealing with the dead-letter topic: events that could not be handled (an invalid message, or a handler that
 * kept failing, e.g. the mail server was down for longer than the retries). Used by `src/scripts/dlq.ts`; every function
 * takes the Kafka client, so it is tested without a broker. Replaying is safe: an event keeps its id, and the handlers are
 * idempotent on it, so a replay can never deliver a notification twice.
 */
export interface DeadLetter {
  partition: number;
  offset: string;
  key: string | null;
  /** The raw message, cut to 2,000 characters. */
  value: string;
  reason?: string;
  error?: string;
  attempts?: string;
  failedAt?: string;
  originalOffset?: string;
  eventId: string | null;
  type: string | null;
}

export interface ReadOptions {
  limit?: number;
  timeoutMs?: number;
}

const MAX_VALUE_CHARS = 2000;
const HARD_LIMIT = 1000;

const text = (value: unknown): string | undefined => (value === undefined || value === null ? undefined : Buffer.isBuffer(value) ? value.toString('utf8') : String(value));

/** `0:12` pairs (partition:offset) from the command line. */
export const parseSelection = (items: string[]): Set<string> => {
  const out = new Set<string>();
  for (const item of items) {
    if (!/^\d+:\d+$/.test(item)) throw new Error(`"${item}" is not a partition:offset pair such as 0:12`);
    out.add(item);
  }
  return out;
};

const describeJson = (raw: string): { eventId: string | null; type: string | null } => {
  try {
    const parsed = JSON.parse(raw);
    return { eventId: typeof parsed?.id === 'string' ? parsed.id : null, type: typeof parsed?.type === 'string' ? parsed.type : null };
  } catch {
    return { eventId: null, type: null };
  }
};

const withAdmin = async <T>(kafka: Kafka, run: (admin: ReturnType<Kafka['admin']>) => Promise<T>): Promise<T> => {
  const admin = kafka.admin();
  await admin.connect();
  try {
    return await run(admin);
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
};

const backlog = (offsets: Array<{ partition: number; high: string; low: string }>) =>
  offsets.map((o) => ({ partition: o.partition, high: Number(o.high), low: Number(o.low) })).filter((o) => o.high > o.low);

export const readDeadLetters = async (kafka: Kafka, settings: KafkaSettings, { limit = 100, timeoutMs = 15_000 }: ReadOptions = {}): Promise<DeadLetter[]> => {
  const wanted = Math.min(Math.max(1, limit), HARD_LIMIT);
  const offsets = await withAdmin(kafka, (admin) => admin.fetchTopicOffsets(settings.dlqTopic));
  const available = backlog(offsets).reduce((sum, o) => sum + (o.high - o.low), 0);
  if (available === 0) return [];
  const expect = Math.min(wanted, available);

  const groupId = `${settings.groupId}-dlq-reader-${crypto.randomBytes(4).toString('hex')}`;
  const consumer = kafka.consumer({ groupId, allowAutoTopicCreation: false });
  const found: DeadLetter[] = [];
  await consumer.connect();
  try {
    await consumer.subscribe({ topic: settings.dlqTopic, fromBeginning: true });
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      void consumer
        .run({
          eachMessage: async ({ partition, message }) => {
            if (found.length >= wanted) return;
            const raw = text(message.value) ?? '';
            const headers = message.headers ?? {};
            found.push({
              partition,
              offset: message.offset,
              key: text(message.key) ?? null,
              value: raw.slice(0, MAX_VALUE_CHARS),
              reason: text(headers['x-reason']),
              error: text(headers['x-error']),
              attempts: text(headers['x-attempts']),
              failedAt: text(headers['x-failed-at']),
              originalOffset: text(headers['x-original-offset']),
              ...describeJson(raw),
            });
            if (found.length >= expect) {
              clearTimeout(timer);
              resolve();
            }
          },
        })
        .catch(() => {
          clearTimeout(timer);
          resolve();
        });
    });
  } finally {
    await consumer.stop().catch(() => undefined);
    await consumer.disconnect().catch(() => undefined);
    await withAdmin(kafka, (admin) => admin.deleteGroups([groupId])).catch(() => undefined);
  }
  return found.sort((a, b) => a.partition - b.partition || Number(a.offset) - Number(b.offset));
};

export interface ReplaySelection {
  all?: boolean;
  /** `partition:offset` pairs. */
  offsets?: string[];
}

export interface ReplayResult {
  dryRun: boolean;
  replayed: Array<{ partition: number; offset: string; eventId: string | null; type: string | null }>;
  skipped: Array<{ partition: number; offset: string; why: string }>;
}

/** Puts events from the dead-letter topic back on the notification topic. A message that is still not a valid event is skipped with the reason. */
export const replayDeadLetters = async (
  kafka: Kafka,
  settings: KafkaSettings,
  selection: ReplaySelection,
  { dryRun = true, timeoutMs = 15_000 }: { dryRun?: boolean; timeoutMs?: number } = {}
): Promise<ReplayResult> => {
  const picked = selection.offsets?.length ? parseSelection(selection.offsets) : null;
  if (!selection.all && !picked) throw new Error('Choose what to replay: --all or --offset <partition:offset>');

  const letters = (await readDeadLetters(kafka, settings, { limit: HARD_LIMIT, timeoutMs })).filter((l) => selection.all || picked!.has(`${l.partition}:${l.offset}`));
  const result: ReplayResult = { dryRun, replayed: [], skipped: [] };
  const ready: Array<{ letter: DeadLetter; value: string }> = [];

  for (const letter of letters) {
    // the stored value is cut for display: read the whole message again from the value we kept only when it fits
    if (letter.value.length >= MAX_VALUE_CHARS) {
      result.skipped.push({ partition: letter.partition, offset: letter.offset, why: 'The message is longer than 2,000 characters: not a notification event' });
      continue;
    }
    try {
      parseEnvelope(JSON.parse(letter.value));
    } catch (error) {
      const why = error instanceof SyntaxError ? 'The message is not valid JSON' : `The message is still invalid: ${(error as Error).message}`;
      result.skipped.push({ partition: letter.partition, offset: letter.offset, why });
      continue;
    }
    ready.push({ letter, value: letter.value });
    result.replayed.push({ partition: letter.partition, offset: letter.offset, eventId: letter.eventId, type: letter.type });
  }

  if (!dryRun && ready.length) {
    const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1, allowAutoTopicCreation: false });
    await producer.connect();
    try {
      for (const { letter, value } of ready) {
        await producer.send({
          topic: settings.topic,
          acks: -1,
          messages: [{ key: letter.key ?? undefined, value, headers: { 'x-replayed-from-dlq': `${letter.partition}:${letter.offset}` } }],
        });
      }
    } finally {
      await producer.disconnect().catch(() => undefined);
    }
  }
  return result;
};

/**
 * How much is waiting: events in the dead-letter topic, and how far the consumer group is behind on the notification topic
 * (messages not yet committed). Used by System status and /metrics.
 */
export const readQueueBacklog = async (kafka: Kafka, settings: KafkaSettings): Promise<{ deadLetters: number; lag: number }> =>
  withAdmin(kafka, async (admin) => {
    const deadLetters = backlog(await admin.fetchTopicOffsets(settings.dlqTopic)).reduce((sum, o) => sum + (o.high - o.low), 0);
    const ends = await admin.fetchTopicOffsets(settings.topic);
    const committed = await admin.fetchOffsets({ groupId: settings.groupId, topics: [settings.topic] });
    const done = new Map<number, number>();
    for (const topic of committed) for (const p of topic.partitions) done.set(p.partition, Number(p.offset));
    let lag = 0;
    for (const end of ends) {
      const committedOffset = done.get(end.partition);
      const from = committedOffset !== undefined && committedOffset >= 0 ? committedOffset : Number(end.low);
      lag += Math.max(0, Number(end.high) - from);
    }
    return { deadLetters, lag };
  });

/** Deletes every message that is in the dead-letter topic now (up to the end of each partition). A dry run only counts. */
export const purgeDeadLetters = async (kafka: Kafka, settings: KafkaSettings, { dryRun = true }: { dryRun?: boolean } = {}): Promise<{ dryRun: boolean; count: number }> =>
  withAdmin(kafka, async (admin) => {
    const pending = backlog(await admin.fetchTopicOffsets(settings.dlqTopic));
    const count = pending.reduce((sum, o) => sum + (o.high - o.low), 0);
    if (!dryRun && pending.length) {
      await admin.deleteTopicRecords({ topic: settings.dlqTopic, partitions: pending.map((o) => ({ partition: o.partition, offset: String(o.high) })) });
    }
    return { dryRun, count };
  });
