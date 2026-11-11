// An in-memory stand-in for the whole stack: the API (just the routes the gates use), the mail catcher, Kafka and Docker
// Compose. It behaves like the real system should, and `bugs` plants a defect so a test can prove the matching gate notices it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../lib/http.mjs';
import { createReport } from '../lib/report.mjs';
import { createHelpers } from '../gates.mjs';

const KNOWN = ['notification.deliver', 'notification.broadcast', 'registration.submitted', 'registration.received', 'registration.approved', 'registration.rejected'];
const STRICT = ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/verify-email'];

export const createWorld = ({ bugs = {}, secrets = [], verification = true } = {}) => {
  const s = {
    users: new Map(),
    tokens: new Map(),
    mails: [],
    notices: [],
    main: [],
    dlq: [],
    backlog: [],
    seen: new Set(),
    apiUp: true,
    kafkaUp: true,
    redisUp: true,
    kafkaStatus: 'up',
    hits: new Map(),
    stopped: new Set(),
    admin: { id: 'admin-1', email: 'verify-admin@aiem.test', password: 'Admin#Password1' },
    office: 'alumni-office@aiem.test',
  };
  s.tokens.set('admin-token', { userId: s.admin.id, role: 'SUPER_ADMIN' });

  const mail = (to, subject, text = '') => s.mails.push({ ID: `m${s.mails.length + 1}`, Subject: subject, To: [{ Address: to }], Text: text, HTML: '', Created: new Date().toISOString() });

  const handle = (envelope) => {
    if (s.seen.has(envelope.id) && !bugs.noIdempotency) return;
    s.seen.add(envelope.id);
    const { type, data } = envelope;
    const user = s.users.get(data.applicantId ?? data.userId);
    if (type === 'registration.received') mail(user.email, 'We received your AIEM Connect registration');
    if (type === 'registration.submitted') {
      s.notices.push({ id: crypto.randomUUID(), type: 'REGISTRATION_PENDING', title: 'New registration to review', isRead: false, metadata: { applicantId: user.id } });
      mail(s.admin.email, `New registration to review: ${user.fullName}`);
      mail(s.office, `New registration to review: ${user.fullName}`);
    }
    if (type === 'registration.approved') mail(user.email, 'Your AIEM Connect registration is approved');
    if (type === 'registration.rejected') mail(user.email, 'Your AIEM Connect registration was not approved', `Reason: ${data.reason}`);
    if (type === 'notification.deliver') s.notices.push({ id: crypto.randomUUID(), type: data.type, title: data.title, isRead: false, metadata: { eventId: envelope.id } });
  };

  const consume = (line) => {
    let envelope;
    try {
      envelope = JSON.parse(line);
      if (typeof envelope.id !== 'string' || envelope.id.length < 8 || envelope.version !== 1 || !KNOWN.includes(envelope.type)) throw new Error('invalid');
    } catch {
      if (!bugs.noDlq) s.dlq.push(line);
      return;
    }
    handle(envelope);
  };

  const toTopic = (line) => {
    s.main.push(line);
    if (!s.apiUp) s.backlog.push(line);
    else consume(line);
  };

  const publish = (type, data) => {
    const envelope = { id: `evt-${crypto.randomBytes(6).toString('hex')}`, type, version: 1, occurredAt: new Date().toISOString(), data };
    if (!s.kafkaUp) {
      if (!bugs.statusStuckUp) s.kafkaStatus = 'down';
      handle(envelope); // the in-process fallback
      return;
    }
    s.kafkaStatus = 'up';
    toTopic(JSON.stringify(envelope));
  };

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const who = (init) => s.tokens.get(String(init.headers?.Authorization ?? '').replace('Bearer ', ''));

  const fetchImpl = async (url, init = {}) => {
    if (!s.apiUp) throw new TypeError('fetch failed');
    const u = new URL(url);
    const p = u.pathname;
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : {};
    const caller = who(init);
    if (STRICT.includes(p)) {
      const n = (s.hits.get(p) ?? 0) + 1;
      s.hits.set(p, n);
      if (n > 10 && !bugs.noLimiter) return json(429, { error: { code: 'RATE_LIMITED' } });
    }
    if (method === 'GET' && (p === '/' || p === '/login')) return new Response('<html>AIEM Connect</html>', { status: 200 });
    if (p === '/health') return json(200, { status: 'ok', databaseStatus: 'up', redisStatus: s.redisUp ? 'up' : 'down', kafkaStatus: s.kafkaStatus });
    if (p === '/api/landing') return json(200, { success: true, data: [] });
    if (p === '/api/auth/login') {
      if (body.email === s.admin.email && body.password === s.admin.password) {
        s.tokens.set('admin-token', { userId: s.admin.id, role: 'SUPER_ADMIN' });
        return json(200, { data: { accessToken: 'admin-token' } });
      }
      const user = [...s.users.values()].find((x) => x.email === body.email && x.password === body.password);
      if (!user) return json(401, { error: { code: 'INVALID_CREDENTIALS' } });
      if (user.status === 'PENDING') return json(403, { error: { code: 'ACCOUNT_PENDING_APPROVAL' } });
      if (user.status === 'REJECTED') return json(403, { error: { code: 'ACCOUNT_REJECTED' } });
      const token = `tok-${user.id}`;
      s.tokens.set(token, { userId: user.id, role: 'MEMBER' });
      return json(200, { data: { accessToken: token, refreshToken: 'r' } });
    }
    if (p === '/api/auth/me') return caller ? json(200, { data: { id: caller.userId, userRole: caller.role } }) : json(401, {});
    if (p === '/api/auth/forgot-password') return json(200, { success: true });
    if (p === '/api/auth/register') {
      const id = `u${s.users.size + 1}`;
      const user = { id, email: String(body.email).toLowerCase(), fullName: body.fullName, password: body.password, status: 'PENDING', verified: false, token: `vt-${id}` };
      s.users.set(id, user);
      if (verification) mail(user.email, 'Verify your AIEM Connect account', `Open http://host/verify-email?token=${user.token}`);
      else {
        user.verified = true;
        publish('registration.received', { userId: id });
        publish('registration.submitted', { applicantId: id });
      }
      return json(201, { data: { id, approvalStatus: 'PENDING' } });
    }
    if (p === '/api/auth/verify-email') {
      const user = [...s.users.values()].find((x) => x.token === body.token);
      if (!user || user.password !== body.password) return json(400, {});
      user.verified = true;
      publish('registration.received', { userId: user.id });
      publish('registration.submitted', { applicantId: user.id });
      return json(200, { message: 'ok' });
    }
    if (!caller || caller.role !== 'SUPER_ADMIN') {
      if (p === '/api/notifications' || p.startsWith('/api/admin')) return json(caller ? 403 : 401, {});
    }
    if (p === '/api/admin/system-status') return json(200, { data: { overall: 'ok', services: ['database', 'cache', 'notifications', 'email', 'approvalAlerts'].map((key) => ({ key, status: 'ok', detail: '' })) } });
    if (p === '/api/admin/approvals' && method === 'GET') {
      const q = (u.searchParams.get('search') ?? '').toLowerCase();
      return json(200, { data: [...s.users.values()].filter((x) => x.status === 'PENDING' && x.verified && x.email.includes(q)).map((x) => ({ id: x.id, email: x.email })) });
    }
    const decision = /^\/api\/admin\/approvals\/([^/]+)\/(approve|reject)$/.exec(p);
    if (decision) {
      const user = s.users.get(decision[1]);
      user.status = decision[2] === 'approve' ? 'APPROVED' : 'REJECTED';
      for (const n of s.notices) if (n.type === 'REGISTRATION_PENDING' && n.metadata.applicantId === user.id && !bugs.staleNotices) n.isRead = true;
      publish(decision[2] === 'approve' ? 'registration.approved' : 'registration.rejected', { userId: user.id, reason: body.reason });
      return json(200, { data: { approvalStatus: user.status } });
    }
    if (p === '/api/admin/users') {
      const q = (u.searchParams.get('search') ?? '').toLowerCase();
      return json(200, { data: [...s.users.values(), s.admin].filter((x) => x.email.includes(q)).map((x) => ({ email: x.email })) });
    }
    if (p === '/api/notifications') return json(200, { data: s.notices });
    return json(404, {});
  };

  const mailApi = {
    base: 'http://mail',
    ready: async () => true,
    clear: async () => ((s.mails = []), true),
    list: async () => s.mails,
    full: async (id) => s.mails.find((m) => m.ID === id),
    subjectsTo: async (to) => s.mails.filter((m) => m.To[0].Address === to).map((m) => m.Subject),
    waitFor: async ({ to, subject }) => {
      const found = s.mails.find((m) => m.To[0].Address.toLowerCase() === String(to).toLowerCase() && m.Subject.includes(subject));
      return found ? { ok: true, message: found, waitedMs: 1 } : { ok: false, message: null, waitedMs: 1 };
    },
  };

  const kafkaTools = {
    listTopics: async () => ['aiem.notifications', 'aiem.notifications.dlq', '__consumer_offsets'],
    describeTopic: async () => ({ partitions: bugs.wrongPartitions ? 1 : 3, replicationFactor: 1 }),
    produce: async (topic, lines) => {
      if (topic === 'aiem.notifications') for (const line of lines) toTopic(line);
      return { code: 0, stdout: '', stderr: '' };
    },
    consume: async (topic) => (topic.endsWith('.dlq') ? s.dlq : s.main),
    groupLag: async () => {
      const lag = s.backlog.length + (bugs.stuckLag ? 5 : 0);
      return { rows: [0, 1, 2].map((n) => ({ topic: 'aiem.notifications', partition: n, current: 1, end: 1 + (n === 0 ? lag : 0), lag: n === 0 ? lag : 0, consumer: 'c1' })), totalLag: lag, unknown: 0, members: 1, raw: 'GROUP ...', code: 0 };
    },
  };

  const services = ['postgres', 'redis', 'kafka', 'api', 'web', 'nginx', 'mailpit'];
  const publishers = { postgres: [{ host: bugs.openPostgres ? '0.0.0.0' : '127.0.0.1', hostPort: 5432, containerPort: 5432, protocol: 'tcp' }], api: [{ host: '127.0.0.1', hostPort: 5000, containerPort: 5000, protocol: 'tcp' }], mailpit: [{ host: '127.0.0.1', hostPort: 8025, containerPort: 8025, protocol: 'tcp' }], web: [{ host: '0.0.0.0', hostPort: 3000, containerPort: 3000, protocol: 'tcp' }], nginx: [{ host: '0.0.0.0', hostPort: 80, containerPort: 80, protocol: 'tcp' }] };
  if (bugs.publishedKafka) publishers.kafka = [{ host: '0.0.0.0', hostPort: 9092, containerPort: 9092, protocol: 'tcp' }];

  const flag = { api: (on) => ((s.apiUp = on), on && flush()), kafka: (on) => (s.kafkaUp = on), redis: (on) => (s.redisUp = on) };
  const flush = () => {
    for (const line of s.backlog.splice(0)) consume(line);
  };
  const setService = (name, on) => {
    on ? s.stopped.delete(name) : s.stopped.add(name);
    flag[name]?.(on);
  };

  const ok = { code: 0, stdout: '', stderr: '' };
  const compose = {
    project: 'aiem-verify',
    config: async () => ok,
    configText: async () => ({ code: 0, stdout: 'services: {}', stderr: '' }),
    up: async () => (services.forEach((n) => setService(n, true)), bugs.upFails ? { code: 1, stdout: '', stderr: 'service api failed to build' } : ok),
    down: async () => (services.forEach((n) => setService(n, false)), ok),
    ps: async () =>
      services.map((service) => ({ service, name: `p-${service}-1`, id: service, state: s.stopped.has(service) ? 'exited' : 'running', health: s.stopped.has(service) || ['mailpit', 'nginx'].includes(service) ? '' : 'healthy', exitCode: 0, publishers: publishers[service] ?? [] })),
    logs: async (service) => ({ code: 0, stdout: `${bugs.leakSecret ? `jwt=${secrets[0]} ` : ''}Server running ${service ?? 'all'}`, stderr: '' }),
    stop: async (name) => (setService(name, false), ok),
    start: async (name) => (setService(name, true), ok),
    restart: async (name) => (setService(name, true), ok),
    execIn: async (service, args) => (args[0] === 'id' ? { code: 0, stdout: bugs.rootUser ? '0\n' : '1001\n', stderr: '' } : ok),
    raw: async () => ok,
    containerId: async (name) => name,
  };

  const exec = async (command, args) => {
    if (command === 'docker' && args[0] === 'version') return { code: 0, stdout: '27.3.1\n', stderr: '' };
    if (command === 'docker' && args[0] === 'compose') return { code: 0, stdout: '2.29.7\n', stderr: '' };
    if (command === 'docker' && args[0] === 'inspect') return { code: 0, stdout: `${bugs.crashLoop && args[3] === 'api' ? 3 : 0}\n`, stderr: '' };
    if (command === 'df') return { code: 0, stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 100000000 1 50000000 1% /\n', stderr: '' };
    if (String(args[0] ?? '').endsWith('verify-deployment.mjs')) return { code: 0, stdout: 'PASS  a\nPASS  b\n', stderr: '' };
    return { code: 127, stdout: '', stderr: 'not available in the fake world' };
  };

  return { s, fetchImpl, mailApi, kafkaTools, compose, exec };
};

/** The context run.mjs builds, wired to a fake world. */
export const makeCtx = (world, { skipDrills = false, stack = true, mail = true, verification = true } = {}) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-gates-'));
  const secrets = ['secret-jwt-value-1234567890'];
  const report = createReport({ outDir: out, secrets });
  const lines = [];
  const http = createClient('http://stack', { fetchImpl: world.fetchImpl, timeoutMs: 2000 });
  const ctx = {
    runId: 'abc123',
    exec: world.exec,
    log: (line) => lines.push(line),
    lines,
    report,
    state: {},
    secrets,
    compose: stack ? world.compose : null,
    kafka: stack ? world.kafkaTools : null,
    mail: mail ? world.mailApi : null,
    http,
    web: http,
    admin: { email: world.s.admin.email, password: world.s.admin.password },
    verificationRequired: verification,
    config: { repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), prefix: 'aiem', groupId: 'aiem-notifications', partitions: 3, skipDrills, noBuild: false, waitSec: 5, expectOfficeMailbox: true, ports: { proxy: 58080, web: 58000, api: 58500, postgres: 58432, mailpit: 58025 } },
  };
  ctx.helpers = createHelpers(ctx);
  return ctx;
};
