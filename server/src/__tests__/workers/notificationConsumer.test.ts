const settings: any = {
  enabled: true,
  consumerEnabled: true,
  brokers: ['kafka:9092'],
  groupId: 'aitd-notifications',
  topic: 'aitd.notifications',
  dlqTopic: 'aitd.notifications.dlq',
  maxAttempts: 3,
  retryBaseMs: 10,
};
const dlqSend = jest.fn();
const consumerCalls: string[] = [];
let runConfig: any;
const failTopicsTimes = { n: 0 };

const fakeConsumer = {
  events: { CRASH: 'consumer.crash' },
  on: jest.fn(),
  connect: jest.fn(async () => consumerCalls.push('connect')),
  subscribe: jest.fn(async () => consumerCalls.push('subscribe')),
  run: jest.fn(async (config: unknown) => {
    runConfig = config;
    consumerCalls.push('run');
  }),
  disconnect: jest.fn(async () => consumerCalls.push('disconnect')),
};

jest.mock('../../config/kafka', () => ({
  readKafkaSettings: () => settings,
  getKafka: () => ({ consumer: () => fakeConsumer }),
  getProducer: jest.fn(async () => ({ send: dlqSend })),
  ensureNotificationTopics: jest.fn(async () => {
    if (failTopicsTimes.n > 0) {
      failTopicsTimes.n--;
      throw new Error('broker not ready');
    }
  }),
  disconnectKafka: jest.fn(async () => undefined),
}));
jest.mock('../../services/notificationEventHandlers', () => ({ handleNotificationEvent: jest.fn() }));

import { processMessage, startNotificationConsumer } from '../../workers/notificationConsumer';
import { handleNotificationEvent } from '../../services/notificationEventHandlers';
import { buildEnvelope } from '../../services/notificationEvents';
import { ensureNotificationTopics, disconnectKafka } from '../../config/kafka';
import { log } from '../../utils/logger';

const handle = handleNotificationEvent as jest.Mock;
const sleeps: number[] = [];
const sleep = async (ms: number) => void sleeps.push(ms);

const messageFor = (envelope: unknown, key = 'u1') => ({ key: Buffer.from(key), value: Buffer.from(JSON.stringify(envelope)), offset: '7' });
const valid = () => buildEnvelope('notification.deliver', { userId: 'u1', type: 'POST_LIKED', title: 't', message: 'm' });

beforeEach(() => {
  jest.clearAllMocks();
  sleeps.length = 0;
  consumerCalls.length = 0;
  failTopicsTimes.n = 0;
  Object.assign(settings, { enabled: true, consumerEnabled: true, maxAttempts: 3, retryBaseMs: 10 });
  dlqSend.mockResolvedValue(undefined);
  handle.mockResolvedValue(undefined);
  jest.spyOn(log, 'error').mockImplementation(() => undefined);
  jest.spyOn(log, 'warn').mockImplementation(() => undefined);
  jest.spyOn(log, 'info').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('processMessage', () => {
  it('hands a valid event to the handlers, marked as a possible redelivery', async () => {
    const envelope = valid();
    await expect(processMessage(messageFor(envelope), { sleep })).resolves.toBe('handled');
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ id: envelope.id, type: 'notification.deliver' }), { redelivery: true });
    expect(dlqSend).not.toHaveBeenCalled();
  });

  it('retries a failing delivery with a doubling pause, then succeeds', async () => {
    handle.mockRejectedValueOnce(new Error('smtp down')).mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce(undefined);
    await expect(processMessage(messageFor(valid()), { sleep })).resolves.toBe('handled');
    expect(handle).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10, 20]);
  });

  it('moves an event that keeps failing to the dead-letter topic, with the reason, and carries on', async () => {
    handle.mockRejectedValue(new Error('smtp down'));
    const envelope = valid();
    await expect(processMessage(messageFor(envelope), { sleep })).resolves.toBe('dead-lettered');
    expect(handle).toHaveBeenCalledTimes(3);
    expect(dlqSend).toHaveBeenCalledTimes(1);
    const record = dlqSend.mock.calls[0][0];
    expect(record.topic).toBe('aitd.notifications.dlq');
    expect(record.messages[0].key.toString()).toBe('u1');
    expect(JSON.parse(record.messages[0].value.toString()).id).toBe(envelope.id);
    expect(record.messages[0].headers).toMatchObject({ 'x-error': 'smtp down', 'x-attempts': '3', 'x-original-topic': 'aitd.notifications', 'x-reason': 'failed' });
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/dead-letter/i), expect.objectContaining({ eventId: envelope.id }));
  });

  it.each([
    ['not JSON', Buffer.from('{oops')],
    ['an unknown event type', Buffer.from(JSON.stringify({ id: 'abcdefgh1', type: 'x.y', version: 1, occurredAt: 'now', data: {} }))],
    ['valid JSON of the wrong shape', Buffer.from(JSON.stringify({ hello: 'world' }))],
    ['an event with bad data', Buffer.from(JSON.stringify({ id: 'abcdefgh1', type: 'registration.approved', version: 1, occurredAt: 'now', data: {} }))],
  ])('does not retry %s: it goes straight to the dead-letter topic', async (_label, value) => {
    await expect(processMessage({ key: null, value, offset: '1' }, { sleep })).resolves.toBe('dead-lettered');
    expect(handle).not.toHaveBeenCalled();
    expect(sleeps).toEqual([]);
    expect(dlqSend.mock.calls[0][0].messages[0].headers['x-reason']).toBe('invalid');
  });

  it('skips an empty message (a tombstone)', async () => {
    await expect(processMessage({ key: null, value: null, offset: '1' }, { sleep })).resolves.toBe('skipped');
    expect(dlqSend).not.toHaveBeenCalled();
  });

  it('does not acknowledge a message it could neither deliver nor dead-letter: Kafka redelivers it', async () => {
    handle.mockRejectedValue(new Error('smtp down'));
    dlqSend.mockRejectedValue(new Error('dlq unreachable'));
    await expect(processMessage(messageFor(valid()), { sleep })).rejects.toThrow('dlq unreachable');
  });

  it('truncates a very long error in the dead-letter header', async () => {
    handle.mockRejectedValue(new Error('x'.repeat(5000)));
    await processMessage(messageFor(valid()), { sleep });
    expect(dlqSend.mock.calls[0][0].messages[0].headers['x-error'].length).toBeLessThanOrEqual(500);
  });
});

describe('startNotificationConsumer', () => {
  const retrySleep = async () => undefined;

  it('does nothing without Kafka, or when a separate worker runs the consumer', () => {
    settings.enabled = false;
    expect(startNotificationConsumer({ sleep: retrySleep })).toBeNull();
    settings.enabled = true;
    settings.consumerEnabled = false;
    expect(startNotificationConsumer({ sleep: retrySleep })).toBeNull();
    expect(fakeConsumer.connect).not.toHaveBeenCalled();
  });

  it('returns at once (the API does not wait for the broker), then creates the topics, joins the group, subscribes and starts delivering', async () => {
    const consumer = startNotificationConsumer({ sleep: retrySleep });
    expect(consumer).not.toBeNull();
    expect(consumerCalls).toEqual([]);
    await consumer!.ready;
    expect(ensureNotificationTopics).toHaveBeenCalledTimes(1);
    expect(consumerCalls).toEqual(['connect', 'subscribe', 'run']);
    expect(fakeConsumer.subscribe).toHaveBeenCalledWith({ topic: 'aitd.notifications', fromBeginning: false });

    const envelope = valid();
    await runConfig.eachMessage({ topic: 'aitd.notifications', partition: 0, message: messageFor(envelope) });
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ id: envelope.id }), { redelivery: true });
  });

  it('keeps trying while the broker is not ready yet instead of crashing the API', async () => {
    failTopicsTimes.n = 2;
    const consumer = startNotificationConsumer({ sleep: retrySleep });
    await consumer!.ready;
    expect(ensureNotificationTopics).toHaveBeenCalledTimes(3);
    expect(consumerCalls).toEqual(['connect', 'subscribe', 'run']);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/could not start/i), expect.any(Object));
  });

  it('leaves the group and closes the connections on shutdown', async () => {
    const consumer = startNotificationConsumer({ sleep: retrySleep });
    await consumer!.ready;
    await consumer!.stop();
    expect(consumerCalls).toContain('disconnect');
    expect(disconnectKafka).toHaveBeenCalled();
  });

  it('stops retrying when it is told to stop', async () => {
    failTopicsTimes.n = 1000;
    let calls = 0;
    const consumer = startNotificationConsumer({
      sleep: async () => {
        calls += 1;
        if (calls >= 2) await consumer!.stop();
      },
    });
    await consumer!.ready;
    expect(calls).toBeLessThan(10);
    expect(consumerCalls).not.toContain('run');
  });
});
