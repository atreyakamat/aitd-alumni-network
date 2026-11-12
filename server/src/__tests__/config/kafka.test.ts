const sent: unknown[] = [];
const createdTopics: unknown[] = [];
const alteredConfigs: any[] = [];
/** What the broker reports as retention.ms per topic ("-1" = keep forever, the Kafka default for some setups). Missing = describe shows the 7-day default. */
const brokerRetention: Record<string, string> = {};
let describeFails = false;
let alterFails = false;
const state = { producerConnects: 0, producerFails: 0, adminDisconnects: 0, producerDisconnects: 0 };
let lastKafkaConfig: any;
let producerListeners: Record<string, () => void> = {};

jest.mock('kafkajs', () => {
  class FakeProducer {
    events = { CONNECT: 'producer.connect', DISCONNECT: 'producer.disconnect' };
    async connect() {
      state.producerConnects++;
      if (state.producerFails > 0) {
        state.producerFails--;
        throw new Error('broker unreachable');
      }
    }
    on(event: string, listener: () => void) {
      producerListeners[event] = listener;
      return () => undefined;
    }
    async send(record: unknown) {
      sent.push(record);
    }
    async disconnect() {
      state.producerDisconnects++;
    }
  }
  class FakeAdmin {
    async connect() {}
    async createTopics(args: unknown) {
      createdTopics.push(args);
      return true;
    }
    async describeConfigs(args: { resources: Array<{ name: string }> }) {
      if (describeFails) throw new Error('not authorized to describe');
      return {
        resources: args.resources.map((r) => ({
          resourceName: r.name,
          configEntries: [{ configName: 'retention.ms', configValue: brokerRetention[r.name] ?? '604800000' }],
        })),
      };
    }
    async alterConfigs(args: unknown) {
      if (alterFails) throw new Error('not authorized to alter');
      alteredConfigs.push(args);
      return {};
    }
    async disconnect() {
      state.adminDisconnects++;
    }
  }
  class Kafka {
    constructor(config: unknown) {
      lastKafkaConfig = config;
    }
    producer() {
      return new FakeProducer();
    }
    admin() {
      return new FakeAdmin();
    }
    consumer() {
      throw new Error('not used here');
    }
  }
  return { Kafka, logLevel: { NOTHING: 0, ERROR: 1, WARN: 2, INFO: 4, DEBUG: 5 }, ConfigResourceTypes: { UNKNOWN: 0, TOPIC: 2, BROKER: 4, BROKER_LOGGER: 8 } };
});

import {
  readKafkaSettings,
  getProducer,
  ensureNotificationTopics,
  kafkaStatus,
  disconnectKafka,
  resetKafkaForTests,
} from '../../config/kafka';

const ENV = { NODE_ENV: 'production', KAFKA_BROKERS: 'kafka:9092' } as NodeJS.ProcessEnv;

beforeEach(async () => {
  await resetKafkaForTests();
  sent.length = 0;
  createdTopics.length = 0;
  Object.assign(state, { producerConnects: 0, producerFails: 0, adminDisconnects: 0, producerDisconnects: 0 });
  producerListeners = {};
  process.env.NODE_ENV = 'test';
  delete process.env.KAFKA_BROKERS;
});

describe('readKafkaSettings', () => {
  it('is off without brokers: notifications are delivered in-process', () => {
    expect(readKafkaSettings({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(readKafkaSettings({ NODE_ENV: 'production', KAFKA_BROKERS: ' , ' } as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it('is always off under the test runner, even with brokers set', () => {
    expect(readKafkaSettings({ NODE_ENV: 'test', KAFKA_BROKERS: 'kafka:9092' } as NodeJS.ProcessEnv).enabled).toBe(false);
  });

  it('reads a broker list and the documented defaults', () => {
    const s = readKafkaSettings({ NODE_ENV: 'production', KAFKA_BROKERS: ' kafka-1:9092 , kafka-2:9092 ' } as NodeJS.ProcessEnv);
    expect(s).toMatchObject({
      enabled: true,
      brokers: ['kafka-1:9092', 'kafka-2:9092'],
      clientId: 'aiem-api',
      groupId: 'aiem-notifications',
      topic: 'aiem.notifications',
      dlqTopic: 'aiem.notifications.dlq',
      ssl: false,
      partitions: 3,
      replicationFactor: 1,
      maxAttempts: 5,
      consumerEnabled: true,
    });
    expect(s.sasl).toBeUndefined();
    expect(s.problems).toEqual([]);
  });

  it('builds topic names from a prefix and refuses a prefix Kafka would reject', () => {
    expect(readKafkaSettings({ ...ENV, KAFKA_TOPIC_PREFIX: 'college.prod' } as NodeJS.ProcessEnv).topic).toBe('college.prod.notifications');
    const bad = readKafkaSettings({ ...ENV, KAFKA_TOPIC_PREFIX: 'bad prefix/!' } as NodeJS.ProcessEnv);
    expect(bad.topic).toBe('aiem.notifications');
    expect(bad.problems.join(' ')).toMatch(/KAFKA_TOPIC_PREFIX/);
  });

  it('reads TLS and SASL settings', () => {
    const s = readKafkaSettings({
      ...ENV,
      KAFKA_SSL: 'true',
      KAFKA_SASL_MECHANISM: 'SCRAM-SHA-512',
      KAFKA_SASL_USERNAME: 'api',
      KAFKA_SASL_PASSWORD: 'p4ss',
    } as NodeJS.ProcessEnv);
    expect(s.ssl).toBe(true);
    expect(s.sasl).toEqual({ mechanism: 'scram-sha-512', username: 'api', password: 'p4ss' });
  });

  it('reports a SASL mechanism without credentials, or an unknown mechanism, as a problem and does not enable SASL', () => {
    const a = readKafkaSettings({ ...ENV, KAFKA_SASL_MECHANISM: 'plain' } as NodeJS.ProcessEnv);
    expect(a.sasl).toBeUndefined();
    expect(a.problems.join(' ')).toMatch(/KAFKA_SASL_USERNAME/);
    const b = readKafkaSettings({ ...ENV, KAFKA_SASL_MECHANISM: 'kerberos', KAFKA_SASL_USERNAME: 'u', KAFKA_SASL_PASSWORD: 'p' } as NodeJS.ProcessEnv);
    expect(b.sasl).toBeUndefined();
    expect(b.problems.join(' ')).toMatch(/KAFKA_SASL_MECHANISM/);
  });

  it('reports a malformed broker address', () => {
    expect(readKafkaSettings({ ...ENV, KAFKA_BROKERS: 'kafka' } as NodeJS.ProcessEnv).problems.join(' ')).toMatch(/host:port/);
  });

  it('clamps numeric settings to sane bounds', () => {
    const s = readKafkaSettings({ ...ENV, KAFKA_PARTITIONS: '0', KAFKA_REPLICATION_FACTOR: '99', KAFKA_MAX_ATTEMPTS: 'abc' } as NodeJS.ProcessEnv);
    expect(s.partitions).toBe(3);
    expect(s.replicationFactor).toBe(1);
    expect(s.maxAttempts).toBe(5);
    expect(readKafkaSettings({ ...ENV, KAFKA_PARTITIONS: '12', KAFKA_MAX_ATTEMPTS: '2' } as NodeJS.ProcessEnv)).toMatchObject({ partitions: 12, maxAttempts: 2 });
  });

  it('lets a separate worker process turn the consumer off for the API', () => {
    expect(readKafkaSettings({ ...ENV, KAFKA_CONSUMER_ENABLED: 'false' } as NodeJS.ProcessEnv).consumerEnabled).toBe(false);
  });
});

describe('kafka client', () => {
  const enable = () => {
    process.env.NODE_ENV = 'production';
    process.env.KAFKA_BROKERS = 'kafka:9092';
  };

  it('reports "disabled" when no broker is configured', () => {
    expect(kafkaStatus()).toBe('disabled');
  });

  it('refuses to hand out a producer when Kafka is not configured', async () => {
    await expect(getProducer()).rejects.toThrow(/not configured/i);
  });

  it('connects once and reuses the producer', async () => {
    enable();
    const a = await getProducer();
    const b = await getProducer();
    expect(a).toBe(b);
    expect(state.producerConnects).toBe(1);
    expect(kafkaStatus()).toBe('up');
  });

  it('passes brokers, client id, TLS and SASL to kafkajs', async () => {
    enable();
    process.env.KAFKA_SSL = 'true';
    process.env.KAFKA_SASL_MECHANISM = 'plain';
    process.env.KAFKA_SASL_USERNAME = 'u';
    process.env.KAFKA_SASL_PASSWORD = 'p';
    await getProducer();
    expect(lastKafkaConfig).toMatchObject({ clientId: 'aiem-api', brokers: ['kafka:9092'], ssl: true, sasl: { mechanism: 'plain', username: 'u', password: 'p' } });
    delete process.env.KAFKA_SSL;
    delete process.env.KAFKA_SASL_MECHANISM;
    delete process.env.KAFKA_SASL_USERNAME;
    delete process.env.KAFKA_SASL_PASSWORD;
  });

  it('survives a failed connection: the status is "down" and the next call tries again', async () => {
    enable();
    state.producerFails = 1;
    await expect(getProducer()).rejects.toThrow('broker unreachable');
    expect(kafkaStatus()).toBe('down');
    await expect(getProducer()).resolves.toBeDefined();
    expect(kafkaStatus()).toBe('up');
    expect(state.producerConnects).toBe(2);
  });

  it('notices when the connection is lost and reconnects on the next use', async () => {
    enable();
    await getProducer();
    producerListeners['producer.disconnect']?.();
    expect(kafkaStatus()).toBe('down');
    await getProducer();
    expect(state.producerConnects).toBe(2);
  });

  it('creates the notification topic and its dead-letter topic with the configured partitions, without waiting on leaders forever', async () => {
    enable();
    process.env.KAFKA_PARTITIONS = '6';
    await ensureNotificationTopics();
    expect(createdTopics).toHaveLength(1);
    const call = createdTopics[0] as { topics: Array<{ topic: string; numPartitions: number; replicationFactor: number }>; waitForLeaders: boolean };
    expect(call.topics.map((t) => t.topic)).toEqual(['aiem.notifications', 'aiem.notifications.dlq']);
    expect(call.topics[0]).toMatchObject({ numPartitions: 6, replicationFactor: 1 });
    expect(call.topics[1].numPartitions).toBe(1);
    expect(call.waitForLeaders).toBe(true);
    expect(state.adminDisconnects).toBe(1);
    delete process.env.KAFKA_PARTITIONS;
  });

  // R3-11: the topics hold personal data (e-mail addresses, applicant names, a rejection reason in the clear); Kafka keeps messages
  // for as long as the topic's retention says, and the broker default may be forever. 7 days is the ceiling, set on BOTH topics.
  describe('retention of the notification and dead-letter topics (R3-11)', () => {
    const SEVEN_DAYS = String(7 * 24 * 60 * 60 * 1000);
    beforeEach(() => {
      alteredConfigs.length = 0;
      for (const key of Object.keys(brokerRetention)) delete brokerRetention[key];
      describeFails = false;
      alterFails = false;
    });
    afterEach(() => {
      delete process.env.KAFKA_RETENTION_MS;
    });

    it('creates both topics with a 7-day retention.ms', async () => {
      enable();
      await ensureNotificationTopics();
      const call = createdTopics[createdTopics.length - 1] as { topics: Array<{ topic: string; configEntries?: Array<{ name: string; value: string }> }> };
      for (const topic of call.topics) {
        expect({ topic: topic.topic, entries: topic.configEntries }).toEqual({ topic: topic.topic, entries: [{ name: 'retention.ms', value: SEVEN_DAYS }] });
      }
    });

    it('brings an EXISTING topic with no limit (or a longer one) down to the retention, and leaves a correct one alone', async () => {
      enable();
      brokerRetention['aiem.notifications'] = '-1';
      brokerRetention['aiem.notifications.dlq'] = SEVEN_DAYS;
      await ensureNotificationTopics();
      expect(alteredConfigs).toHaveLength(1);
      expect(alteredConfigs[0].resources).toEqual([
        { type: 2, name: 'aiem.notifications', configEntries: [{ name: 'retention.ms', value: SEVEN_DAYS }] },
      ]);

      alteredConfigs.length = 0;
      brokerRetention['aiem.notifications'] = SEVEN_DAYS;
      brokerRetention['aiem.notifications.dlq'] = String(90 * 24 * 60 * 60 * 1000);
      await ensureNotificationTopics();
      expect(alteredConfigs.map((c) => c.resources[0].name)).toEqual(['aiem.notifications.dlq']);
    });

    it('KAFKA_RETENTION_MS shortens it, is bounded (an hour to 30 days), and an unusable value falls back to 7 days', () => {
      expect(readKafkaSettings({ KAFKA_BROKERS: 'k:9092' } as any).retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
      expect(readKafkaSettings({ KAFKA_BROKERS: 'k:9092', KAFKA_RETENTION_MS: '86400000' } as any).retentionMs).toBe(86_400_000);
      for (const bad of ['-1', '0', '1000', 'forever', String(365 * 24 * 60 * 60 * 1000), '']) {
        expect(readKafkaSettings({ KAFKA_BROKERS: 'k:9092', KAFKA_RETENTION_MS: bad } as any).retentionMs).toBe(7 * 24 * 60 * 60 * 1000);
      }
    });

    it('a broker that refuses to describe or alter the config does not stop the API from starting (it logs), the topics are still created', async () => {
      enable();
      describeFails = true;
      await expect(ensureNotificationTopics()).resolves.toBeUndefined();
      describeFails = false;
      alterFails = true;
      brokerRetention['aiem.notifications'] = '-1';
      await expect(ensureNotificationTopics()).resolves.toBeUndefined();
      expect(state.adminDisconnects).toBeGreaterThanOrEqual(2);
    });
  });

  it('disconnects the producer on shutdown and goes back to "down"', async () => {
    enable();
    await getProducer();
    await disconnectKafka();
    expect(state.producerDisconnects).toBe(1);
    expect(kafkaStatus()).toBe('down');
  });
});
