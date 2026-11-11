const sent: unknown[] = [];
const createdTopics: unknown[] = [];
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
  return { Kafka, logLevel: { NOTHING: 0, ERROR: 1, WARN: 2, INFO: 4, DEBUG: 5 } };
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

  it('disconnects the producer on shutdown and goes back to "down"', async () => {
    enable();
    await getProducer();
    await disconnectKafka();
    expect(state.producerDisconnects).toBe(1);
    expect(kafkaStatus()).toBe('down');
  });
});
