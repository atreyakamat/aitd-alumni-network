// Kafka checks through the broker's own command-line tools (apache/kafka keeps them in /opt/kafka/bin), run with
// `docker compose exec` inside the kafka container. Nothing needs to be installed on the host and the broker is never published.
const BIN = '/opt/kafka/bin';
const BOOT = ['--bootstrap-server', 'localhost:9092'];

export const parseTopicList = (stdout) =>
  String(stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** `kafka-topics.sh --describe` first line: `Topic: x  TopicId: ...  PartitionCount: 3  ReplicationFactor: 1 ...` */
export const parseTopicDescription = (stdout) => {
  const partitions = /PartitionCount:\s*(\d+)/.exec(String(stdout ?? ''));
  const replication = /ReplicationFactor:\s*(\d+)/.exec(String(stdout ?? ''));
  return { partitions: partitions ? Number(partitions[1]) : null, replicationFactor: replication ? Number(replication[1]) : null };
};

/**
 * `kafka-consumer-groups.sh --describe --group G`:
 *   GROUP TOPIC PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG CONSUMER-ID HOST CLIENT-ID
 * Returns { rows, totalLag, members } (a partition without a committed offset shows "-" and counts its whole backlog as unknown).
 */
export const parseConsumerGroup = (stdout) => {
  const rows = [];
  for (const line of String(stdout ?? '').split('\n')) {
    const cells = line.trim().split(/\s+/);
    if (cells.length < 6 || cells[0] === 'GROUP' || !/^\d+$/.test(cells[2])) continue;
    const num = (value) => (/^-?\d+$/.test(value) ? Number(value) : null);
    rows.push({ topic: cells[1], partition: Number(cells[2]), current: num(cells[3]), end: num(cells[4]), lag: num(cells[5]), consumer: cells[6] ?? '-' });
  }
  const known = rows.filter((row) => row.lag !== null);
  return {
    rows,
    totalLag: known.reduce((sum, row) => sum + row.lag, 0),
    unknown: rows.length - known.length,
    members: new Set(rows.map((row) => row.consumer).filter((consumer) => consumer && consumer !== '-')).size,
  };
};

export const createKafkaTools = (compose) => {
  const tool = (name, args, options) => compose.execIn('kafka', [`${BIN}/${name}`, ...BOOT, ...args], options);
  return {
    listTopics: async () => {
      const result = await tool('kafka-topics.sh', ['--list']);
      if (result.code !== 0) throw new Error(`kafka-topics failed: ${result.stderr.trim().slice(0, 300)}`);
      return parseTopicList(result.stdout);
    },
    describeTopic: async (topic) => {
      const result = await tool('kafka-topics.sh', ['--describe', '--topic', topic]);
      if (result.code !== 0) throw new Error(`kafka-topics --describe failed: ${result.stderr.trim().slice(0, 300)}`);
      return parseTopicDescription(result.stdout);
    },
    /** Sends one message per line. With `key`, every line is sent as "key|value" and the key decides the partition. */
    produce: async (topic, lines, { key } = {}) => {
      const body = lines.map((line) => (key ? `${key}|${line}` : line)).join('\n') + '\n';
      const extra = key ? ['--property', 'parse.key=true', '--property', 'key.separator=|'] : [];
      return tool('kafka-console-producer.sh', ['--topic', topic, ...extra], { input: body, timeoutMs: 60_000 });
    },
    /** Reads up to `max` messages from the start of a topic (waiting at most `timeoutMs` for the last one). */
    consume: async (topic, { max = 100, timeoutMs = 15_000 } = {}) => {
      const result = await tool('kafka-console-consumer.sh', ['--topic', topic, '--from-beginning', '--max-messages', String(max), '--timeout-ms', String(timeoutMs)], {
        timeoutMs: timeoutMs + 30_000,
      });
      return String(result.stdout ?? '')
        .split('\n')
        .map((line) => line.trimEnd())
        .filter(Boolean);
    },
    groupLag: async (group) => {
      const result = await tool('kafka-consumer-groups.sh', ['--describe', '--group', group]);
      return { ...parseConsumerGroup(result.stdout), raw: result.stdout, code: result.code };
    },
  };
};
