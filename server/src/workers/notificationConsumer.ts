import type { Consumer } from 'kafkajs';
import {
  disconnectKafka,
  ensureNotificationTopics,
  getKafka,
  getProducer,
  readKafkaSettings,
} from '../config/kafka';
import { log } from '../utils/logger';
import { handleNotificationEvent } from '../services/notificationEventHandlers';
import { parseEnvelope } from '../services/notificationEvents';

/**
 * The consumer that delivers notification events: in-app notifications, the e-mail to the college administrator when a
 * registration is waiting, and the e-mails to applicants.
 *
 * Delivery is at-least-once. A failing delivery is retried here with a doubling pause (this holds up one partition for a
 * moment, which keeps one member's events in order). After KAFKA_MAX_ATTEMPTS the event goes to the dead-letter topic with the
 * error, so one bad event can never block the others. A message that is not a valid event is dead-lettered at once.
 * A message that can be neither delivered nor dead-lettered is NOT acknowledged: Kafka redelivers it.
 */
export interface RawMessage {
  key: Buffer | null;
  value: Buffer | null;
  offset?: string;
}

export interface ProcessDeps {
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BACKOFF_MS = 30_000;
const MAX_ERROR_HEADER = 500;
const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_HEADER);

const deadLetter = async (message: RawMessage, reason: 'invalid' | 'failed', error: unknown, attempts: number) => {
  const settings = readKafkaSettings();
  const producer = await getProducer();
  await producer.send({
    topic: settings.dlqTopic,
    acks: -1,
    messages: [
      {
        key: message.key,
        value: message.value,
        headers: {
          'x-reason': reason,
          'x-error': errorText(error),
          'x-attempts': String(attempts),
          'x-original-topic': settings.topic,
          'x-original-offset': message.offset ?? '',
          'x-failed-at': new Date().toISOString(),
        },
      },
    ],
  });
};

export const processMessage = async (message: RawMessage, deps: ProcessDeps = {}): Promise<'handled' | 'dead-lettered' | 'skipped'> => {
  if (!message.value) return 'skipped';
  const settings = readKafkaSettings();
  const sleep = deps.sleep ?? defaultSleep;

  let envelope;
  try {
    envelope = parseEnvelope(JSON.parse(message.value.toString('utf8')));
  } catch (error) {
    log.error('Notification event is not valid; moving it to the dead-letter topic', { offset: message.offset, err: error });
    await deadLetter(message, 'invalid', error, 0);
    return 'dead-lettered';
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= settings.maxAttempts; attempt++) {
    try {
      await handleNotificationEvent(envelope, { redelivery: true });
      return 'handled';
    } catch (error) {
      lastError = error;
      log.warn('Delivering a notification event failed', { eventId: envelope.id, type: envelope.type, attempt, of: settings.maxAttempts, err: error });
      if (attempt < settings.maxAttempts) await sleep(Math.min(settings.retryBaseMs * 2 ** (attempt - 1), MAX_BACKOFF_MS));
    }
  }

  log.error('Notification event keeps failing; moving it to the dead-letter topic', { eventId: envelope.id, type: envelope.type, err: lastError });
  await deadLetter(message, 'failed', lastError, settings.maxAttempts);
  return 'dead-lettered';
};

export interface ConsumerHandle {
  /** Resolves when the consumer is running (or has been stopped before it could start). */
  ready: Promise<void>;
  stop(): Promise<void>;
}

const RESTART_DELAY_MS = 5000;

/**
 * Starts the consumer in the background. Returns null when Kafka is not configured or when a separate worker runs it.
 * It never throws and never makes the API wait: while the broker is unreachable it keeps trying, and the API keeps working
 * (events are then delivered in-process by the publisher's fallback).
 */
export const startNotificationConsumer = (deps: ProcessDeps = {}): ConsumerHandle | null => {
  const settings = readKafkaSettings();
  if (!settings.enabled || !settings.consumerEnabled) return null;

  const sleep = deps.sleep ?? defaultSleep;
  let stopped = false;
  let consumer: Consumer | undefined;

  const run = async (): Promise<void> => {
    while (!stopped) {
      try {
        await ensureNotificationTopics();
        consumer = getKafka(settings).consumer({ groupId: settings.groupId, allowAutoTopicCreation: false });
        consumer.on(consumer.events.CRASH, (event) => {
          log.error('Kafka consumer crashed', { err: event.payload.error, restart: event.payload.restart });
          if (!stopped && !event.payload.restart) {
            ready = run();
          }
        });
        await consumer.connect();
        if (stopped) return;
        await consumer.subscribe({ topic: settings.topic, fromBeginning: false });
        await consumer.run({
          eachMessage: async ({ message }) => {
            await processMessage({ key: message.key, value: message.value, offset: message.offset }, deps);
          },
        });
        log.info('Kafka notification consumer running', { topic: settings.topic, group: settings.groupId });
        return;
      } catch (error) {
        log.error('Kafka notification consumer could not start; trying again', { err: error, inMs: RESTART_DELAY_MS });
        await consumer?.disconnect().catch(() => undefined);
        consumer = undefined;
        await sleep(RESTART_DELAY_MS);
      }
    }
  };

  let ready = run();
  return {
    get ready() {
      return ready;
    },
    stop: async () => {
      stopped = true;
      await consumer?.disconnect().catch((error: unknown) => log.warn('Kafka consumer did not close cleanly', { err: error }));
      await disconnectKafka();
    },
  };
};
