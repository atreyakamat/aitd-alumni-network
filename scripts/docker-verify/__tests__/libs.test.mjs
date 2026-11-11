import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { makeEnv, ADMIN_EMAIL } from '../lib/envfile.mjs';
import { createCompose, parseComposePs } from '../lib/compose.mjs';
import { parseTopicList, parseTopicDescription, parseConsumerGroup, createKafkaTools } from '../lib/kafka.mjs';
import { extractVerificationToken, createMailpit } from '../lib/mailpit.mjs';
import { createReport } from '../lib/report.mjs';
import { until, setSleepScale } from '../lib/http.mjs';

setSleepScale(0.001);

const counterBytes = () => {
  let n = 0;
  return (size) => Buffer.alloc(size, ++n);
};

describe('envfile', () => {
  test('derives every URL from the host name and puts the proxy port in only when it is not 80', () => {
    const plain = makeEnv({ host: 'atreya-2', randomBytes: counterBytes() });
    assert.equal(plain.values.FRONTEND_URL, 'http://atreya-2');
    assert.equal(plain.values.NEXT_PUBLIC_API_URL, 'http://atreya-2/api');
    assert.match(plain.values.CORS_ORIGINS, /^http:\/\/atreya-2,/);
    const odd = makeEnv({ host: 'box', proxyPort: 8080, randomBytes: counterBytes() });
    assert.equal(odd.values.FRONTEND_URL, 'http://box:8080');
    assert.equal(odd.values.NEXT_PUBLIC_API_URL, 'http://box:8080/api');
    assert.equal(odd.values.PROXY_HOST_PORT, '8080');
  });

  test('generates different secrets each time, long enough, and the admin password meets the policy', () => {
    const a = makeEnv();
    const b = makeEnv();
    assert.notEqual(a.values.JWT_SECRET, b.values.JWT_SECRET);
    assert.ok(a.values.JWT_SECRET.length >= 32 && a.values.JWT_REFRESH_SECRET.length >= 32);
    assert.notEqual(a.values.JWT_SECRET, a.values.JWT_REFRESH_SECRET);
    const pw = a.adminPassword;
    assert.ok(pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw));
    assert.equal(a.adminEmail, ADMIN_EMAIL);
  });

  test('is safe to use as a compose env file: no quotes, no $ interpolation, one KEY=value per line', () => {
    const env = makeEnv();
    for (const line of env.text.split('\n').filter((l) => l && !l.startsWith('#'))) {
      assert.match(line, /^[A-Z_]+=[^\s'"$`]*$/, line);
    }
  });

  test('lists the secrets that must never reach a log or the evidence', () => {
    const env = makeEnv();
    assert.deepEqual(new Set(env.secrets), new Set([env.values.POSTGRES_PASSWORD, env.values.JWT_SECRET, env.values.JWT_REFRESH_SECRET, env.adminPassword]));
  });
});

describe('compose wrapper', () => {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    return { code: 0, stdout: '', stderr: '' };
  };
  const compose = createCompose({ exec, cwd: '/repo', envFile: '/tmp/.env.verify' });

  test('always uses its own project, the env file, both files and the proxy profile', async () => {
    calls.length = 0;
    await compose.config();
    const { command, args, options } = calls[0];
    assert.equal(command, 'docker');
    assert.deepEqual(args.slice(0, 7), ['compose', '-p', 'aiem-verify', '--env-file', '/tmp/.env.verify', '-f', 'docker-compose.yml']);
    assert.ok(args.includes('docker-compose.test.yml'));
    assert.deepEqual(args.slice(args.indexOf('--profile'), args.indexOf('--profile') + 2), ['--profile', 'proxy']);
    assert.deepEqual(args.slice(-2), ['config', '-q']);
    assert.equal(options.cwd, '/repo');
  });

  test('up builds, waits for health and gives the wait a timeout; --no-build leaves --build out', async () => {
    calls.length = 0;
    await compose.up({ waitTimeoutSec: 600 });
    let args = calls[0].args;
    assert.ok(args.includes('--build') && args.includes('--wait'));
    assert.equal(args[args.indexOf('--wait-timeout') + 1], '600');
    calls.length = 0;
    await compose.up({ build: false });
    assert.ok(!calls[0].args.includes('--build'));
  });

  test('down removes volumes only when asked, and execIn never allocates a TTY', async () => {
    calls.length = 0;
    await compose.down({ volumes: false });
    assert.ok(!calls[0].args.includes('-v'));
    await compose.down({ volumes: true });
    assert.ok(calls[1].args.includes('-v'));
    await compose.execIn('kafka', ['ls'], { input: 'x' });
    const exe = calls[2].args;
    assert.ok(exe.includes('exec') && exe.includes('-T'));
    assert.deepEqual(exe.slice(-2), ['kafka', 'ls']);
    assert.equal(calls[2].options.input, 'x');
  });

  test('parses both shapes of `compose ps --format json` and the published ports', () => {
    const row = { Service: 'api', Name: 'p-api-1', ID: 'abc', State: 'running', Health: 'healthy', ExitCode: 0, Publishers: [{ URL: '127.0.0.1', TargetPort: 5000, PublishedPort: 5000, Protocol: 'tcp' }, { URL: '', TargetPort: 9, PublishedPort: 0, Protocol: 'tcp' }] };
    const ndjson = parseComposePs(`${JSON.stringify(row)}\n${JSON.stringify({ ...row, Service: 'web' })}\n`);
    const array = parseComposePs(JSON.stringify([row]));
    assert.equal(ndjson.length, 2);
    assert.equal(array[0].service, 'api');
    assert.deepEqual(array[0].publishers, [{ host: '127.0.0.1', hostPort: 5000, containerPort: 5000, protocol: 'tcp' }]);
    assert.equal(array[0].health, 'healthy');
    assert.deepEqual(parseComposePs(''), []);
  });
});

describe('kafka helpers', () => {
  test('parses a topic list and a topic description', () => {
    assert.deepEqual(parseTopicList('aiem.notifications\naiem.notifications.dlq\n__consumer_offsets\n'), ['aiem.notifications', 'aiem.notifications.dlq', '__consumer_offsets']);
    assert.deepEqual(parseTopicDescription('Topic: aiem.notifications\tTopicId: abc\tPartitionCount: 3\tReplicationFactor: 1\tConfigs: \n\tTopic: x\tPartition: 0'), { partitions: 3, replicationFactor: 1 });
  });

  test('parses a consumer group table: lag per partition, unknown offsets, members', () => {
    const table = [
      '',
      'GROUP               TOPIC               PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG  CONSUMER-ID           HOST        CLIENT-ID',
      'aiem-notifications  aiem.notifications  0          12              12              0    kafkajs-abc-1         /172.18.0.5 kafkajs',
      'aiem-notifications  aiem.notifications  1          7               9               2    kafkajs-abc-1         /172.18.0.5 kafkajs',
      'aiem-notifications  aiem.notifications  2          -               4               -    -                     -           -',
      '',
    ].join('\n');
    const parsed = parseConsumerGroup(table);
    assert.equal(parsed.rows.length, 3);
    assert.equal(parsed.totalLag, 2);
    assert.equal(parsed.unknown, 1);
    assert.equal(parsed.members, 1);
    assert.deepEqual(parseConsumerGroup("Consumer group 'x' has no active members.").rows, []);
  });

  test('produce sends one line per message, with a key separator only when a key is given', async () => {
    const seen = [];
    const compose = { execIn: async (service, args, options) => (seen.push({ service, args, options }), { code: 0, stdout: '', stderr: '' }) };
    const kafka = createKafkaTools(compose);
    await kafka.produce('t', ['a', 'b']);
    assert.equal(seen[0].service, 'kafka');
    assert.equal(seen[0].options.input, 'a\nb\n');
    assert.ok(!seen[0].args.includes('parse.key=true'));
    await kafka.produce('t', ['{"x":1}'], { key: 'user-1' });
    assert.equal(seen[1].options.input, 'user-1|{"x":1}\n');
    assert.ok(seen[1].args.includes('parse.key=true') && seen[1].args.includes('key.separator=|'));
  });
});

describe('mailpit helpers', () => {
  test('finds the verification token in text or HTML and decodes it', () => {
    assert.equal(extractVerificationToken({ Text: 'Open http://atreya-2/verify-email?token=abc123_-.xyz now' }), 'abc123_-.xyz');
    assert.equal(extractVerificationToken({ HTML: '<a href="http://h/verify-email?token=a%2Bb%3D">go</a>' }), 'a+b=');
    assert.equal(extractVerificationToken({ Text: 'no link here' }), null);
  });

  test('waitFor matches the address case-insensitively and the subject by substring, and gives up after the timeout', async () => {
    const messages = [{ ID: '1', Subject: 'Your AIEM Connect registration is approved', To: [{ Address: 'Ada@AIEM.test' }] }];
    const http = {
      base: 'http://m',
      get: async (url) => (url.startsWith('/api/v1/messages') ? { status: 200, json: { messages } } : { status: 200, json: { ID: '1', Text: 'hello' } }),
    };
    const mail = createMailpit('http://m', { http });
    const found = await mail.waitFor({ to: 'ada@aiem.test', subject: 'registration is approved', timeoutMs: 200, intervalMs: 5 });
    assert.equal(found.ok, true);
    assert.equal(found.message.Text, 'hello');
    const missing = await mail.waitFor({ to: 'ada@aiem.test', subject: 'rejected', timeoutMs: 30, intervalMs: 5 });
    assert.equal(missing.ok, false);
  });
});

describe('polling', () => {
  test('until resolves when the check turns truthy, swallows exceptions, and reports a timeout without throwing', async () => {
    let n = 0;
    const ok = await until(async () => {
      n += 1;
      if (n < 3) throw new Error('not yet');
      return 'yes';
    }, { timeoutMs: 1_000_000, intervalMs: 5_000 }); // the test sleep scale (0.001) makes this 1 s and 5 ms
    assert.deepEqual([ok.ok, ok.value], [true, 'yes']);
    const never = await until(async () => null, { timeoutMs: 20_000, intervalMs: 5_000 });
    assert.equal(never.ok, false);
  });
});

describe('evidence report', () => {
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'verify-report-'));

  test('redacts secrets everywhere, counts results and writes a manifest that matches the files', () => {
    const out = dir();
    const report = createReport({ outDir: out, secrets: ['super-secret-value-123'] });
    const file = report.evidence('log.txt', 'token=super-secret-value-123 ok');
    report.record({ id: 'G1', phase: 'x', title: 'works', status: 'pass', detail: 'used super-secret-value-123', files: [file] });
    report.record({ id: 'G2', phase: 'x', title: 'breaks', status: 'fail', detail: 'boom' });
    report.record({ id: 'G3', phase: 'x', title: 'skipped', status: 'skip', detail: 'no docker' });
    fs.mkdirSync(path.join(out, 'private'), { recursive: true });
    fs.writeFileSync(path.join(out, 'private', 'credentials.json'), '{"adminPassword":"super-secret-value-123"}');
    const done = report.finish({ commit: 'abc', dirty: false, hostname: 'h', platform: 'p', node: 'v20', mode: 'test' });

    assert.deepEqual(done.counts, { pass: 1, fail: 1, skip: 1 });
    assert.equal(done.ok, false);
    assert.equal(fs.readFileSync(path.join(out, 'evidence', 'log.txt'), 'utf8'), 'token=[REDACTED] ok');
    const md = fs.readFileSync(path.join(out, 'REPORT.md'), 'utf8');
    assert.match(md, /# Docker and Kafka verification: FAIL/);
    assert.ok(!md.includes('super-secret-value-123'));
    assert.match(md, /### G2 breaks/);

    const manifest = fs.readFileSync(path.join(out, 'manifest.sha256'), 'utf8').trim().split('\n');
    assert.ok(manifest.every((line) => !line.includes('private/')), 'private files are never in the manifest');
    for (const line of manifest) {
      const [hash, name] = line.split('  ');
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(out, name))).digest('hex'), hash, name);
    }
    assert.ok(manifest.some((line) => line.endsWith('  REPORT.md')) && manifest.some((line) => line.endsWith('  report.json')));
  });
});
