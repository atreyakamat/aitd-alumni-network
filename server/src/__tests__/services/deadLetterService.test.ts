import { readDeadLetters, replayDeadLetters, purgeDeadLetters, parseSelection, readQueueBacklog } from '../../services/deadLetterService';

/** A tiny in-memory broker: one dead-letter partition and one notification topic, with the pieces of kafkajs the tool uses. */
const makeBroker = (dlq: Array<{ key?: string; value: string; headers?: Record<string, string> }>) => {
  const sent: any[] = [];
  const deleted: any[] = [];
  const deletedGroups: string[] = [];
  const messages = dlq.map((m, i) => ({
    key: m.key ? Buffer.from(m.key) : null,
    value: Buffer.from(m.value),
    offset: String(i),
    headers: Object.fromEntries(Object.entries(m.headers ?? {}).map(([k, v]) => [k, Buffer.from(v)])),
  }));
  const kafka: any = {
    admin: () => ({
      connect: async () => undefined,
      disconnect: async () => undefined,
      fetchTopicOffsets: async () => [{ partition: 0, offset: String(messages.length), high: String(messages.length), low: '0' }],
      deleteTopicRecords: async (args: unknown) => deleted.push(args),
      deleteGroups: async (groups: string[]) => deletedGroups.push(...groups),
    }),
    consumer: () => {
      let handler: any;
      return {
        connect: async () => undefined,
        subscribe: async () => undefined,
        run: async ({ eachMessage }: any) => {
          handler = eachMessage;
          setImmediate(async () => {
            for (const message of messages) await handler({ partition: 0, message });
          });
        },
        stop: async () => undefined,
        disconnect: async () => undefined,
      };
    },
    producer: () => ({ connect: async () => undefined, send: async (r: unknown) => sent.push(r), disconnect: async () => undefined }),
  };
  return { kafka, sent, deleted, deletedGroups };
};

const settings: any = { topic: 'aiem.notifications', dlqTopic: 'aiem.notifications.dlq', groupId: 'aiem-notifications' };
const valid = (id = 'evt-12345678') => JSON.stringify({ id, type: 'registration.approved', version: 1, occurredAt: new Date().toISOString(), data: { userId: 'u1' } });
const headers = { 'x-reason': 'failed', 'x-error': 'smtp down', 'x-attempts': '5', 'x-failed-at': '2026-11-12T00:00:00.000Z' };

describe('readDeadLetters', () => {
  it('lists the dead letters with the reason, error and attempts, and decodes the event id and type', async () => {
    const { kafka, deletedGroups } = makeBroker([
      { key: 'u1', value: valid(), headers },
      { value: 'not json at all', headers: { 'x-reason': 'invalid', 'x-error': 'bad json' } },
    ]);
    const list = await readDeadLetters(kafka, settings, { limit: 10, timeoutMs: 1000 });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ partition: 0, offset: '0', key: 'u1', reason: 'failed', error: 'smtp down', attempts: '5', eventId: 'evt-12345678', type: 'registration.approved' });
    expect(list[1]).toMatchObject({ offset: '1', reason: 'invalid', eventId: null, type: null });
    expect(deletedGroups).toHaveLength(1); // the temporary reader group is removed again
  });

  it('truncates long values and honours the limit', async () => {
    const { kafka } = makeBroker([{ value: 'x'.repeat(5000), headers }, { value: valid(), headers }]);
    const list = await readDeadLetters(kafka, settings, { limit: 1, timeoutMs: 1000 });
    expect(list).toHaveLength(1);
    expect(list[0].value.length).toBeLessThanOrEqual(2000);
  });

  it('answers an empty list for an empty topic without waiting', async () => {
    const { kafka } = makeBroker([]);
    const started = Date.now();
    expect(await readDeadLetters(kafka, settings, { limit: 10, timeoutMs: 5000 })).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('replayDeadLetters', () => {
  it('shows what it would do without sending anything (dry run is the default)', async () => {
    const { kafka, sent } = makeBroker([{ key: 'u1', value: valid(), headers }]);
    const result = await replayDeadLetters(kafka, settings, { all: true }, { timeoutMs: 1000 });
    expect(result.dryRun).toBe(true);
    expect(result.replayed).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });

  it('puts valid events back on the notification topic with their key and a replay header', async () => {
    const { kafka, sent } = makeBroker([{ key: 'u1', value: valid('evt-aaaaaaaa'), headers }]);
    const result = await replayDeadLetters(kafka, settings, { all: true }, { dryRun: false, timeoutMs: 1000 });
    expect(result.replayed).toEqual([expect.objectContaining({ offset: '0', eventId: 'evt-aaaaaaaa' })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].topic).toBe('aiem.notifications');
    expect(sent[0].messages[0].key).toBe('u1');
    expect(JSON.parse(sent[0].messages[0].value).id).toBe('evt-aaaaaaaa'); // same id: the handlers are idempotent, a replay cannot double-deliver
    expect(sent[0].messages[0].headers['x-replayed-from-dlq']).toBe('0:0');
  });

  it('never replays a message that is still invalid: it says why', async () => {
    const bad = JSON.stringify({ id: 'evt-bbbbbbbb', type: 'does.not.exist', version: 1, occurredAt: 'x', data: {} });
    const { kafka, sent } = makeBroker([{ value: 'garbage', headers }, { value: bad, headers }]);
    const result = await replayDeadLetters(kafka, settings, { all: true }, { dryRun: false, timeoutMs: 1000 });
    expect(sent).toHaveLength(0);
    expect(result.replayed).toEqual([]);
    expect(result.skipped.map((s) => s.offset)).toEqual(['0', '1']);
    expect(result.skipped[0].why).toMatch(/not valid JSON/i);
    expect(result.skipped[1].why).toMatch(/Unknown event type|invalid/i);
  });

  it('replays only the selected offsets', async () => {
    const { kafka, sent } = makeBroker([{ value: valid('evt-00000001'), headers }, { value: valid('evt-00000002'), headers }]);
    const result = await replayDeadLetters(kafka, settings, { offsets: ['0:1'] }, { dryRun: false, timeoutMs: 1000 });
    expect(result.replayed.map((r) => r.eventId)).toEqual(['evt-00000002']);
    expect(sent).toHaveLength(1);
  });

  it('refuses to run without a selection', async () => {
    const { kafka } = makeBroker([{ value: valid(), headers }]);
    await expect(replayDeadLetters(kafka, settings, {}, { timeoutMs: 1000 })).rejects.toThrow(/--all or --offset/);
  });
});

describe('purgeDeadLetters', () => {
  it('deletes up to the end of every partition, only when asked for', async () => {
    const { kafka, deleted } = makeBroker([{ value: valid(), headers }, { value: valid('evt-22222222'), headers }]);
    const dry = await purgeDeadLetters(kafka, settings, { dryRun: true });
    expect(dry).toEqual({ dryRun: true, count: 2 });
    expect(deleted).toHaveLength(0);
    const real = await purgeDeadLetters(kafka, settings, { dryRun: false });
    expect(real.count).toBe(2);
    expect(deleted[0]).toEqual({ topic: 'aiem.notifications.dlq', partitions: [{ partition: 0, offset: '2' }] });
  });
});

describe('parseSelection', () => {
  it('parses "partition:offset" and rejects anything else', () => {
    expect(parseSelection(['0:5', '0:7'])).toEqual(new Set(['0:5', '0:7']));
    expect(() => parseSelection(['five'])).toThrow(/partition:offset/);
  });
});

describe('readQueueBacklog', () => {
  const brokerWith = (dlqHigh: number, mainHigh: number, committed: Array<[number, string]>) => ({
    admin: () => ({
      connect: async () => undefined,
      disconnect: async () => undefined,
      fetchTopicOffsets: async (topic: string) =>
        topic.endsWith('.dlq')
          ? [{ partition: 0, offset: String(dlqHigh), high: String(dlqHigh), low: '0' }]
          : [0, 1].map((partition) => ({ partition, offset: String(mainHigh), high: String(mainHigh), low: '0' })),
      fetchOffsets: async () => [{ topic: 'aiem.notifications', partitions: committed.map(([partition, offset]) => ({ partition, offset, metadata: null })) }],
    }),
  });

  it('counts the dead letters and how far the consumer is behind on every partition', async () => {
    const kafka: any = brokerWith(3, 10, [[0, '8'], [1, '10']]);
    expect(await readQueueBacklog(kafka, settings)).toEqual({ deadLetters: 3, lag: 2 });
  });

  it('counts a partition without a committed offset as fully behind', async () => {
    const kafka: any = brokerWith(0, 4, [[0, '-1']]);
    expect(await readQueueBacklog(kafka, settings)).toEqual({ deadLetters: 0, lag: 8 });
  });
});
