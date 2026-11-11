import { Kafka, logLevel, type KafkaConfig, type Producer, type SASLOptions } from 'kafkajs';
import { log } from '../utils/logger';

/**
 * Kafka carries the notification events (in-app notifications, the e-mails to the college administrator and to
 * applicants). Like Redis it is OPTIONAL at run time: without KAFKA_BROKERS (and always under the test runner) events are
 * handled in-process, so development and tests need no broker. With brokers, the API publishes events and a consumer
 * (in the API process, or a separate worker) delivers them.
 */

export type KafkaState = 'disabled' | 'up' | 'down';

export interface KafkaSettings {
  enabled: boolean;
  brokers: string[];
  clientId: string;
  groupId: string;
  topic: string;
  dlqTopic: string;
  ssl: boolean;
  sasl?: { mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512'; username: string; password: string };
  partitions: number;
  replicationFactor: number;
  /** Delivery attempts for one event before it goes to the dead-letter topic. */
  maxAttempts: number;
  /** First pause between attempts; it doubles each time. */
  retryBaseMs: number;
  /** The API process runs the consumer unless a separate worker does (KAFKA_CONSUMER_ENABLED=false). */
  consumerEnabled: boolean;
  /** Misconfiguration the production guard reports (the settings above fall back to safe values). */
  problems: string[];
}

const SASL_MECHANISMS = ['plain', 'scram-sha-256', 'scram-sha-512'] as const;
const TOPIC_PREFIX = /^[A-Za-z0-9._-]{1,100}$/;
const BROKER = /^[A-Za-z0-9._-]+:\d{1,5}$/;

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const boundedInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};

const flag = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
};

export const readKafkaSettings = (env: NodeJS.ProcessEnv = process.env): KafkaSettings => {
  const problems: string[] = [];
  const brokers = list(env.KAFKA_BROKERS);

  let prefix = (env.KAFKA_TOPIC_PREFIX ?? '').trim() || 'aiem';
  if (!TOPIC_PREFIX.test(prefix)) {
    problems.push('KAFKA_TOPIC_PREFIX may only contain letters, digits, ".", "_" and "-" (using "aiem")');
    prefix = 'aiem';
  }

  for (const broker of brokers) {
    if (!BROKER.test(broker)) {
      problems.push(`KAFKA_BROKERS entry "${broker}" must look like host:port`);
    }
  }

  let sasl: KafkaSettings['sasl'];
  const mechanism = (env.KAFKA_SASL_MECHANISM ?? '').trim().toLowerCase();
  if (mechanism) {
    if (!(SASL_MECHANISMS as readonly string[]).includes(mechanism)) {
      problems.push(`KAFKA_SASL_MECHANISM must be one of ${SASL_MECHANISMS.join(', ')}`);
    } else if (!env.KAFKA_SASL_USERNAME || !env.KAFKA_SASL_PASSWORD) {
      problems.push('KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD are both needed when KAFKA_SASL_MECHANISM is set');
    } else {
      sasl = { mechanism: mechanism as (typeof SASL_MECHANISMS)[number], username: env.KAFKA_SASL_USERNAME, password: env.KAFKA_SASL_PASSWORD };
    }
  }

  return {
    enabled: brokers.length > 0 && env.NODE_ENV !== 'test',
    brokers,
    clientId: (env.KAFKA_CLIENT_ID ?? '').trim() || 'aiem-api',
    groupId: (env.KAFKA_GROUP_ID ?? '').trim() || 'aiem-notifications',
    topic: `${prefix}.notifications`,
    dlqTopic: `${prefix}.notifications.dlq`,
    ssl: flag(env.KAFKA_SSL, false),
    sasl,
    partitions: boundedInt(env.KAFKA_PARTITIONS, 3, 1, 100),
    replicationFactor: boundedInt(env.KAFKA_REPLICATION_FACTOR, 1, 1, 5),
    maxAttempts: boundedInt(env.KAFKA_MAX_ATTEMPTS, 5, 1, 20),
    retryBaseMs: boundedInt(env.KAFKA_RETRY_BASE_MS, 1000, 0, 60_000),
    consumerEnabled: flag(env.KAFKA_CONSUMER_ENABLED, true),
    problems,
  };
};

// ---- client ---------------------------------------------------------------------------------------------------------

let kafka: Kafka | undefined;
let kafkaKey = '';
let producer: Producer | undefined;
let producerPromise: Promise<Producer> | undefined;
let producerConnected = false;

const kafkaLogCreator = () => ({ level, log: entry }: { level: number; log: { message: string; [key: string]: unknown } }) => {
  const { message, namespace: _namespace, ...rest } = entry as { message: string; namespace?: unknown; [key: string]: unknown };
  const fields = { source: 'kafkajs', ...rest };
  if (level === logLevel.ERROR) log.error(message, fields);
  else if (level === logLevel.WARN) log.warn(message, fields);
  else if (level === logLevel.INFO) log.info(message, fields);
  else log.debug(message, fields);
};

export const getKafka = (settings: KafkaSettings = readKafkaSettings()): Kafka => {
  if (!settings.enabled) throw new Error('Kafka is not configured (KAFKA_BROKERS is empty)');
  const key = JSON.stringify([settings.brokers, settings.clientId, settings.ssl, settings.sasl?.mechanism, settings.sasl?.username]);
  if (!kafka || key !== kafkaKey) {
    const config: KafkaConfig = {
      clientId: settings.clientId,
      brokers: settings.brokers,
      ssl: settings.ssl,
      ...(settings.sasl ? { sasl: settings.sasl as SASLOptions } : {}),
      logLevel: logLevel.WARN,
      logCreator: kafkaLogCreator,
      connectionTimeout: 5000,
      requestTimeout: 15_000,
      retry: { initialRetryTime: 300, retries: 5 },
    };
    kafka = new Kafka(config);
    kafkaKey = key;
  }
  return kafka;
};

export const kafkaStatus = (): KafkaState => {
  if (!readKafkaSettings().enabled) return 'disabled';
  return producerConnected ? 'up' : 'down';
};

/** One idempotent producer per process, connected on first use. A failed connection is retried by the next call. */
export const getProducer = async (): Promise<Producer> => {
  const settings = readKafkaSettings();
  if (!settings.enabled) throw new Error('Kafka is not configured (KAFKA_BROKERS is empty)');
  if (producer && producerConnected) return producer;
  if (producerPromise) return producerPromise;

  const created = getKafka(settings).producer({ idempotent: true, maxInFlightRequests: 1, allowAutoTopicCreation: false });
  created.on(created.events.DISCONNECT, () => {
    producerConnected = false;
    log.warn('Kafka producer disconnected');
  });
  producerPromise = created
    .connect()
    .then(() => {
      producer = created;
      producerConnected = true;
      return created;
    })
    .catch((error: unknown) => {
      producerConnected = false;
      throw error;
    })
    .finally(() => {
      producerPromise = undefined;
    });
  return producerPromise;
};

/** Creates the notification topic and its dead-letter topic (no-op when they exist). Auto-creation is off on the broker. */
export const ensureNotificationTopics = async (): Promise<void> => {
  const settings = readKafkaSettings();
  const admin = getKafka(settings).admin();
  await admin.connect();
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: [
        { topic: settings.topic, numPartitions: settings.partitions, replicationFactor: settings.replicationFactor },
        { topic: settings.dlqTopic, numPartitions: 1, replicationFactor: settings.replicationFactor },
      ],
    });
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
};

export const disconnectKafka = async (): Promise<void> => {
  const current = producer;
  producer = undefined;
  producerConnected = false;
  if (current) await current.disconnect().catch((error: unknown) => log.warn('Kafka producer did not close cleanly', { err: error }));
};

/** Test helper: forget every cached client. */
export const resetKafkaForTests = async (): Promise<void> => {
  producer = undefined;
  producerPromise = undefined;
  producerConnected = false;
  kafka = undefined;
  kafkaKey = '';
};
