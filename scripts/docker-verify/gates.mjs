// The verification gates. Each gate is { id, phase, title, needs, blocking?, run(ctx) }: it returns { detail, files? } on
// success and throws on failure. `needs` names what the gate cannot do without: 'stack' (Docker Compose controls the stack),
// 'kafka' (the broker's tools are reachable), 'mail' (the mail catcher), 'drills' (stack and not --skip-drills), 'admin'
// (a signed-in administrator), 'web' (the web app's address is known). A gate whose needs are missing is SKIPPED, never failed.
import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import { until, sleep } from './lib/http.mjs';
import { extractVerificationToken } from './lib/mailpit.mjs';
import { brief } from './lib/exec.mjs';

export const SUBJECT = {
  verify: 'Verify your AIEM Connect account',
  received: 'We received your AIEM Connect registration',
  adminNew: 'New registration to review',
  approved: 'Your AIEM Connect registration is approved',
  rejected: 'Your AIEM Connect registration was not approved',
};
export const OFFICE_MAILBOX = 'alumni-office@aiem.test';

const must = (condition, message) => {
  if (!condition) throw new Error(message);
};
const rand = (n = 6) => crypto.randomBytes(n).toString('hex');
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

export const isPortOpen = (port, host = '127.0.0.1', timeoutMs = 800) =>
  new Promise((resolve) => {
    const socket = net.connect({ port: Number(port), host });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });

const versionAtLeast = (text, minimum) => {
  const parts = String(text).match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < minimum.length; i++) {
    if ((parts[i] ?? 0) > minimum[i]) return true;
    if ((parts[i] ?? 0) < minimum[i]) return false;
  }
  return true;
};

/** Everything a gate needs, built once from the context: the applicants, the administrator's view and the mail checks. */
export const createHelpers = (ctx) => {
  const { http, mail } = ctx;
  let applicantCount = 0;

  const newApplicant = (label) => {
    applicantCount += 1;
    const tag = `${label}${applicantCount}`;
    return {
      label,
      email: `verify.${ctx.runId}.${tag}@aiem.test`.toLowerCase(),
      password: `Verify#${rand(6)}Aa1`,
      fullName: `Verify Applicant ${label.toUpperCase()}${applicantCount}`,
      enrollmentNumber: `V${ctx.runId}${tag}`.slice(0, 40),
    };
  };

  const register = async (applicant) => {
    const response = await http.post('/api/auth/register', {
      email: applicant.email,
      password: applicant.password,
      fullName: applicant.fullName,
      batchYear: 2016,
      department: 'Computer Engineering',
      degree: 'B.E.',
      enrollmentNumber: applicant.enrollmentNumber,
      verificationNote: 'automated verification run',
    });
    must(response.status === 201, `registration answered ${response.status} ${response.error ?? response.text.slice(0, 160)}`);
    must(response.json?.data?.approvalStatus === 'PENDING', `a new registration must be PENDING, got ${response.json?.data?.approvalStatus}`);
    applicant.registeredAt = Date.now();
    applicant.registerMs = response.ms;
    return response;
  };

  /** With e-mail verification on: reads the link from the mail catcher and uses it, as the applicant would. */
  const verifyEmail = async (applicant, timeoutMs = 60_000) => {
    const found = await mail.waitFor({ to: applicant.email, subject: SUBJECT.verify, timeoutMs });
    must(found.ok, `the verification e-mail to ${applicant.email} did not arrive within ${seconds(timeoutMs)}`);
    const token = extractVerificationToken(found.message);
    must(token, 'the verification e-mail has no verify-email link');
    const response = await http.post('/api/auth/verify-email', { token, password: applicant.password });
    must(response.status === 200, `verify-email answered ${response.status} ${response.text.slice(0, 160)}`);
    applicant.verifiedAt = Date.now();
    applicant.verifyMs = response.ms;
    return response;
  };

  const registerAndVerify = async (applicant) => {
    await register(applicant);
    if (ctx.verificationRequired) await verifyEmail(applicant);
    return applicant;
  };

  const adminToken = () => ctx.state.adminToken;

  const findApplicantId = async (applicant) => {
    if (applicant.id) return applicant.id;
    const found = await until(
      async () => {
        const response = await http.get(`/api/admin/approvals?status=PENDING&search=${encodeURIComponent(applicant.email)}`, { token: adminToken() });
        return response.json?.data?.find((row) => String(row.email).toLowerCase() === applicant.email);
      },
      { timeoutMs: 30_000 }
    );
    must(found.ok, `${applicant.email} is not in the administrator's review queue`);
    applicant.id = found.value.id;
    return applicant.id;
  };

  const notices = async () => {
    const response = await http.get('/api/notifications?limit=100', { token: adminToken() });
    return response.json?.data ?? response.json?.notifications ?? [];
  };

  const waitForNotice = (predicate, timeoutMs = 60_000) => until(async () => (await notices()).find(predicate), { timeoutMs, intervalMs: 1_500 });

  const waitForReviewNotice = async (applicant, timeoutMs = 60_000) => {
    const id = await findApplicantId(applicant);
    return waitForNotice((n) => n.type === 'REGISTRATION_PENDING' && n.metadata?.applicantId === id, timeoutMs);
  };

  /** The "registration received" mail to the applicant and the "new registration" mails to the administrator and the office. */
  const waitForRegistrationMails = async (applicant, timeoutMs = 60_000) => {
    const out = {};
    const started = Date.now();
    out.received = await mail.waitFor({ to: applicant.email, subject: SUBJECT.received, timeoutMs });
    must(out.received.ok, `"${SUBJECT.received}" to ${applicant.email} did not arrive within ${seconds(timeoutMs)}`);
    const subject = `${SUBJECT.adminNew}: ${applicant.fullName}`;
    out.admin = await mail.waitFor({ to: ctx.admin.email, subject, timeoutMs });
    must(out.admin.ok, `"${subject}" to the administrator ${ctx.admin.email} did not arrive within ${seconds(timeoutMs)}`);
    if (ctx.config.expectOfficeMailbox) {
      out.office = await mail.waitFor({ to: OFFICE_MAILBOX, subject, timeoutMs: 20_000 });
      must(out.office.ok, `the copy to the shared mailbox ${OFFICE_MAILBOX} (APPROVAL_NOTIFY_EMAIL) did not arrive`);
    }
    out.totalMs = Date.now() - started;
    return out;
  };

  const kafkaEnvelope = (type, data, id = `verify-${ctx.runId}-${rand(4)}`) => ({ id, type, version: 1, occurredAt: new Date().toISOString(), data });

  const adminDeliver = async (title) => {
    const me = await http.get('/api/auth/me', { token: adminToken() });
    const userId = me.json?.data?.id ?? me.json?.user?.id;
    must(userId, 'cannot read the administrator id');
    return {
      userId,
      envelope: kafkaEnvelope('notification.deliver', {
        userId,
        type: 'ADMIN_ANNOUNCEMENT',
        title,
        message: 'Automated Kafka verification message. Safe to ignore.',
        link: '/notifications',
        metadata: null,
      }),
    };
  };

  const waitForHealth = (predicate, timeoutMs = 120_000) =>
    until(
      async () => {
        const response = await http.get('/health', { timeout: 5_000 });
        return response.status === 200 && predicate(response.json ?? {}) ? response.json : null;
      },
      { timeoutMs, intervalMs: 2_000 }
    );

  const waitForServiceHealthy = (service, timeoutMs = 240_000) =>
    until(
      async () => {
        const rows = await ctx.compose.ps();
        const row = rows.find((r) => r.service === service);
        return row && row.state === 'running' && (row.health === 'healthy' || row.health === '') ? row : null;
      },
      { timeoutMs, intervalMs: 3_000 }
    );

  const groupLagZero = (timeoutMs = 45_000) =>
    until(
      async () => {
        const lag = await ctx.kafka.groupLag(ctx.config.groupId);
        return lag.rows.length > 0 && lag.totalLag === 0 && lag.unknown === 0 ? lag : null;
      },
      { timeoutMs, intervalMs: 3_000 }
    );

  return {
    newApplicant,
    register,
    verifyEmail,
    registerAndVerify,
    findApplicantId,
    notices,
    waitForNotice,
    waitForReviewNotice,
    waitForRegistrationMails,
    kafkaEnvelope,
    adminDeliver,
    waitForHealth,
    waitForServiceHealthy,
    groupLagZero,
  };
};

export const buildGates = () => {
  const gates = [];
  const gate = (id, phase, title, needs, run, extra = {}) => gates.push({ id, phase, title, needs, run, ...extra });

  // ---------------------------------------------------------------- preflight
  gate('P01', 'preflight', 'Docker Engine and Compose v2 are present and recent enough', ['stack'], async (ctx) => {
    const engine = await ctx.exec('docker', ['version', '--format', '{{.Server.Version}}']);
    must(engine.code === 0, `docker is not usable: ${brief(engine)}`);
    const compose = await ctx.exec('docker', ['compose', 'version', '--short']);
    must(compose.code === 0, `docker compose v2 is missing: ${brief(compose)}`);
    must(versionAtLeast(engine.stdout.trim(), [24]), `Docker Engine ${engine.stdout.trim()} is older than 24`);
    must(versionAtLeast(compose.stdout.trim().replace(/^v/, ''), [2, 20]), `Docker Compose ${compose.stdout.trim()} is older than 2.20 (needed for up --wait-timeout)`);
    ctx.state.dockerVersion = `docker ${engine.stdout.trim()}`;
    ctx.state.composeVersion = `compose ${compose.stdout.trim()}`;
    return { detail: `${ctx.state.dockerVersion}, ${ctx.state.composeVersion}` };
  }, { blocking: true });

  gate('P02', 'preflight', 'The machine has room for the stack (memory and disk)', ['stack'], async (ctx) => {
    const os = await import('node:os');
    const totalGb = os.totalmem() / 1024 ** 3;
    const freeGb = os.freemem() / 1024 ** 3;
    let disk = 'disk: not measured';
    const df = await ctx.exec('df', ['-Pk', ctx.config.repoRoot]);
    if (df.code === 0) {
      const cells = df.stdout.trim().split('\n').pop().trim().split(/\s+/);
      const freeDiskGb = Number(cells[3]) / 1024 ** 2;
      must(freeDiskGb >= 8, `only ${freeDiskGb.toFixed(1)} GB of disk is free; the images and volumes need about 8 GB`);
      disk = `${freeDiskGb.toFixed(1)} GB disk free`;
    }
    must(totalGb >= 3, `only ${totalGb.toFixed(1)} GB of RAM: Kafka (512 MB heap), the API, the web app and PostgreSQL need about 3 GB`);
    return { detail: `${totalGb.toFixed(1)} GB RAM (${freeGb.toFixed(1)} free), ${disk}` };
  });

  gate('P03', 'preflight', 'The ports the stack publishes are free', ['stack'], async (ctx) => {
    const wanted = ctx.config.ports;
    const busy = [];
    for (const [name, port] of Object.entries(wanted)) if (await isPortOpen(port)) busy.push(`${name} :${port}`);
    must(busy.length === 0, `already in use on this machine: ${busy.join(', ')}. Stop that, or choose other ports with --proxy-port/--web-port/--api-port/--postgres-port/--mailpit-port`);
    return { detail: Object.entries(wanted).map(([n, p]) => `${n}:${p}`).join(' ') };
  }, { blocking: true });

  // ---------------------------------------------------------------- stack
  gate('S01', 'stack', 'docker compose config is valid for the base file plus the test overlay', ['stack'], async (ctx) => {
    const result = await ctx.compose.config();
    must(result.code === 0, `compose config failed: ${brief(result)}`);
    const text = await ctx.compose.configText();
    return { detail: 'valid', files: [ctx.report.evidence('compose-config.yml', text.stdout)] };
  });

  gate(
    'S02',
    'stack',
    'Build the images and start every service; all health checks turn healthy',
    ['stack'],
    async (ctx) => {
      const started = Date.now();
      const result = await ctx.compose.up({ build: !ctx.config.noBuild, waitTimeoutSec: ctx.config.waitSec });
      const files = [ctx.report.evidence('compose-up.log', `${result.stdout}\n${result.stderr}`)];
      if (result.code !== 0) {
        const logs = await ctx.compose.logs(undefined, { tail: 150 });
        files.push(ctx.report.evidence('compose-up-failure-logs.txt', logs.stdout + logs.stderr));
        ctx.state.stackFailed = true;
        const error = new Error(`docker compose up failed (exit ${result.code}): ${brief(result)}`);
        error.files = files;
        throw error;
      }
      ctx.state.stackUp = true;
      return { detail: `up and healthy in ${seconds(Date.now() - started)}`, files };
    },
    { blocking: true }
  );

  gate('S03', 'stack', 'Every container is running, healthy and has not restarted', ['stack', 'up'], async (ctx) => {
    const rows = await ctx.compose.ps();
    const expected = ['postgres', 'redis', 'kafka', 'api', 'web', 'nginx', 'mailpit'];
    const problems = [];
    const lines = [];
    for (const service of expected) {
      const row = rows.find((r) => r.service === service);
      if (!row) {
        problems.push(`${service}: not found`);
        continue;
      }
      const inspect = await ctx.exec('docker', ['inspect', '-f', '{{.RestartCount}}', row.id]);
      const restarts = Number(inspect.stdout.trim() || 0);
      lines.push(`${service}\tstate=${row.state}\thealth=${row.health || 'none'}\trestarts=${restarts}`);
      if (row.state !== 'running') problems.push(`${service} is ${row.state}`);
      if (row.health && row.health !== 'healthy') problems.push(`${service} health is ${row.health}`);
      if (restarts > 0) problems.push(`${service} restarted ${restarts} time(s) (a crash loop?)`);
    }
    const file = ctx.report.evidence('containers.tsv', lines.join('\n'));
    must(problems.length === 0, problems.join('; '));
    return { detail: `${expected.length} services running`, files: [file] };
  });

  gate('S04', 'stack', 'The application containers do not run as root', ['stack', 'up'], async (ctx) => {
    const out = [];
    for (const service of ['api', 'web']) {
      const result = await ctx.compose.execIn(service, ['id', '-u']);
      must(result.code === 0, `cannot run id in ${service}: ${brief(result)}`);
      const uid = result.stdout.trim();
      out.push(`${service}=${uid}`);
      must(uid !== '0', `${service} runs as root (uid 0)`);
    }
    return { detail: out.join(' ') };
  });

  gate('S05', 'stack', 'Only the intended ports are published, and the data services only on this machine', ['stack', 'up'], async (ctx) => {
    const rows = await ctx.compose.ps();
    const loopbackOnly = ['postgres', 'api', 'mailpit'];
    const none = ['redis', 'kafka'];
    const problems = [];
    const lines = [];
    for (const row of rows) {
      const published = row.publishers.map((p) => `${p.host}:${p.hostPort}->${p.containerPort}`);
      lines.push(`${row.service}\t${published.join(', ') || '(none)'}`);
      if (none.includes(row.service) && published.length) problems.push(`${row.service} must not publish a port but publishes ${published.join(', ')}`);
      if (loopbackOnly.includes(row.service)) {
        const open = row.publishers.filter((p) => !['127.0.0.1', '::1'].includes(p.host));
        if (open.length) problems.push(`${row.service} is reachable from the network: ${open.map((p) => `${p.host}:${p.hostPort}`).join(', ')}`);
      }
    }
    const file = ctx.report.evidence('published-ports.tsv', lines.join('\n'));
    must(problems.length === 0, problems.join('; '));
    const web = rows.find((r) => r.service === 'web');
    const note = web?.publishers.some((p) => !['127.0.0.1', '::1'].includes(p.host)) ? ' (note: the web app port is published on every interface too, next to nginx)' : '';
    return { detail: `ok${note}`, files: [file] };
  });

  // ---------------------------------------------------------------- application
  gate('A01', 'app', 'The API is healthy: database, Redis and Kafka report up', [], async (ctx) => {
    const health = await ctx.helpers.waitForHealth((body) => body.databaseStatus === 'up', 120_000);
    must(health.ok, 'GET /health never reported databaseStatus "up"');
    const body = health.value;
    ctx.state.kafkaEnabled = body.kafkaStatus !== 'disabled';
    const problems = [];
    if (ctx.compose) {
      if (body.redisStatus !== 'up') problems.push(`redisStatus is ${body.redisStatus}`);
      if (body.kafkaStatus !== 'up') problems.push(`kafkaStatus is ${body.kafkaStatus}`);
    }
    must(problems.length === 0, `${problems.join('; ')} (health: ${JSON.stringify(body)})`);
    return { detail: JSON.stringify({ db: body.databaseStatus, redis: body.redisStatus, kafka: body.kafkaStatus }) };
  });

  gate('A02', 'app', 'The web app serves the home and sign-in pages, branded AIEM Connect', ['web'], async (ctx) => {
    const seen = [];
    for (const page of ['/', '/login']) {
      const response = await ctx.web.get(page);
      must(response.status === 200, `GET ${page} answered ${response.status}`);
      must(/AIEM Connect/.test(response.text), `GET ${page} does not mention AIEM Connect`);
      must(!/AITD/i.test(response.text), `GET ${page} still mentions the old college name`);
      seen.push(`${page} 200`);
    }
    return { detail: seen.join(', ') };
  });

  gate('A03', 'app', 'The read-only deployment checks pass (headers, CORS, private community, receipts)', [], async (ctx) => {
    const script = path.join(ctx.config.repoRoot, 'server', 'scripts', 'verify-deployment.mjs');
    must(fs.existsSync(script), 'server/scripts/verify-deployment.mjs is missing');
    const result = await ctx.exec(process.execPath, [script, '--web', ctx.web?.base ?? ctx.http.base, '--api', ctx.http.base, '--allow-http'], { timeoutMs: 120_000 });
    const file = ctx.report.evidence('verify-deployment.txt', `${result.stdout}\n${result.stderr}`);
    const failed = result.stdout.split('\n').filter((line) => line.startsWith('FAIL'));
    const error = new Error(failed.length ? `${failed.length} check(s) failed: ${failed.slice(0, 4).join(' | ')}` : `verify-deployment exited ${result.code}`);
    error.files = [file];
    if (result.code !== 0 || failed.length) throw error;
    return { detail: `${result.stdout.split('\n').filter((l) => l.startsWith('PASS')).length} checks passed`, files: [file] };
  });

  gate('A04', 'app', 'The seeded administrator can sign in and is a super admin', [], async (ctx) => {
    const response = await ctx.http.post('/api/auth/login', { email: ctx.admin.email, password: ctx.admin.password });
    must(response.status === 200, `administrator login answered ${response.status} ${response.text.slice(0, 160)}`);
    const token = response.json?.data?.accessToken;
    must(token, 'no access token in the login answer');
    const me = await ctx.http.get('/api/auth/me', { token });
    must(me.status === 200, `/auth/me answered ${me.status}`);
    const role = me.json?.data?.userRole ?? me.json?.data?.role;
    must(['SUPER_ADMIN', 'ADMIN'].includes(role), `unexpected role ${role}`);
    ctx.state.adminToken = token;
    return { detail: `role ${role}` };
  });

  gate('A05', 'app', 'System status: database, cache, notifications, e-mail and registration alerts are working', ['admin'], async (ctx) => {
    const response = await ctx.http.get('/api/admin/system-status', { token: ctx.state.adminToken });
    must(response.status === 200, `system-status answered ${response.status}`);
    const services = Object.fromEntries((response.json?.data?.services ?? []).map((s) => [s.key, s]));
    const expectOk = ctx.compose ? ['database', 'cache', 'notifications', 'email', 'approvalAlerts'] : ['database'];
    const bad = expectOk.filter((key) => services[key]?.status !== 'ok').map((key) => `${key}=${services[key]?.status ?? 'missing'} (${services[key]?.detail ?? ''})`);
    const file = ctx.report.evidence('system-status.json', JSON.stringify(response.json?.data, null, 2));
    const error = new Error(`not ok: ${bad.join('; ')}`);
    error.files = [file];
    if (bad.length) throw error;
    return { detail: `overall ${response.json.data.overall}`, files: [file] };
  });

  // ---------------------------------------------------------------- kafka pipeline
  gate('K01', 'kafka', 'Both topics exist, and the notification topic has the configured partitions', ['kafka'], async (ctx) => {
    const topics = await ctx.kafka.listTopics();
    const main = `${ctx.config.prefix}.notifications`;
    const dlq = `${main}.dlq`;
    must(topics.includes(main), `topic ${main} does not exist (topics: ${topics.join(', ')})`);
    must(topics.includes(dlq), `topic ${dlq} does not exist`);
    const description = await ctx.kafka.describeTopic(main);
    must(description.partitions === ctx.config.partitions, `${main} has ${description.partitions} partitions, expected ${ctx.config.partitions}`);
    return { detail: `${main} (${description.partitions} partitions) and ${dlq}` };
  });

  gate('K02', 'kafka', 'The consumer group is running (it has joined and owns the partitions)', ['kafka'], async (ctx) => {
    const ready = await until(async () => {
      const lag = await ctx.kafka.groupLag(ctx.config.groupId);
      return lag.rows.length > 0 && lag.members >= 1 ? lag : null;
    }, { timeoutMs: 60_000, intervalMs: 3_000 });
    must(ready.ok, `consumer group ${ctx.config.groupId} has no members`);
    return { detail: `${ready.value.members} member(s), ${ready.value.rows.length} partition(s)`, files: [ctx.report.evidence('consumer-group.txt', ready.value.raw)] };
  });

  gate('F01', 'flow', 'Registration: verification e-mail, then the applicant, the administrator and the office are all told', ['admin'], async (ctx) => {
    const h = ctx.helpers;
    if (ctx.mail) await ctx.mail.clear();
    const a = h.newApplicant('a');
    ctx.state.applicantA = a;
    await h.registerAndVerify(a);
    const facts = [`register ${seconds(a.registerMs)}`];
    if (a.verifyMs) facts.push(`verify ${seconds(a.verifyMs)}`);
    must(a.registerMs < 10_000, `registration took ${seconds(a.registerMs)}: the request must not wait for e-mail`);
    const notice = await h.waitForReviewNotice(a, 60_000);
    must(notice.ok, 'the administrator got no in-app "New registration to review" notice within 60 s');
    facts.push(`in-app notice after ${seconds(notice.waitedMs)}`);
    const files = [];
    if (ctx.mail) {
      const mails = await h.waitForRegistrationMails(a, 60_000);
      facts.push(`mails to applicant, administrator${ctx.config.expectOfficeMailbox ? ' and office' : ''} within ${seconds(mails.totalMs)}`);
      files.push(ctx.report.evidence('mail-subjects-applicant-a.txt', (await ctx.mail.subjectsTo(a.email)).join('\n')));
    }
    return { detail: facts.join('; '), files };
  });

  gate('F02', 'flow', 'A registration that is not approved cannot sign in', ['admin'], async (ctx) => {
    const a = ctx.state.applicantA;
    must(a, 'no applicant from the registration gate');
    const response = await ctx.http.post('/api/auth/login', { email: a.email, password: a.password });
    must(response.status === 403, `login of a pending applicant answered ${response.status}, expected 403`);
    must(response.json?.error?.code === 'ACCOUNT_PENDING_APPROVAL', `expected ACCOUNT_PENDING_APPROVAL, got ${response.json?.error?.code}`);
    must(!/accessToken|refreshToken/.test(response.text), 'a pending applicant must not receive tokens');
    return { detail: 'ACCOUNT_PENDING_APPROVAL, no tokens' };
  });

  gate('F03', 'flow', 'Approval: the applicant is told by e-mail, can sign in, and the review notice is cleared', ['admin'], async (ctx) => {
    const h = ctx.helpers;
    const a = ctx.state.applicantA;
    must(a, 'no applicant from the registration gate');
    const id = await h.findApplicantId(a);
    const approve = await ctx.http.post(`/api/admin/approvals/${id}/approve`, { note: 'automated verification' }, { token: ctx.state.adminToken });
    must(approve.status === 200, `approve answered ${approve.status} ${approve.text.slice(0, 160)}`);
    const facts = ['approved'];
    if (ctx.mail) {
      const mailed = await ctx.mail.waitFor({ to: a.email, subject: SUBJECT.approved, timeoutMs: 60_000 });
      must(mailed.ok, `"${SUBJECT.approved}" did not arrive within 60 s`);
      facts.push(`mail after ${seconds(mailed.waitedMs)}`);
    }
    const login = await ctx.http.post('/api/auth/login', { email: a.email, password: a.password });
    must(login.status === 200 && login.json?.data?.accessToken, `the approved applicant cannot sign in (${login.status})`);
    a.token = login.json.data.accessToken;
    facts.push('signs in');
    const settled = await until(async () => {
      const notices = await h.notices();
      const mine = notices.filter((n) => n.type === 'REGISTRATION_PENDING' && n.metadata?.applicantId === id);
      return mine.length > 0 && mine.every((n) => n.isRead) ? true : null;
    }, { timeoutMs: 20_000, intervalMs: 1_500 });
    must(settled.ok, 'the "New registration to review" notice is still unread after the decision');
    facts.push('review notice settled');
    return { detail: facts.join('; ') };
  });

  gate('F04', 'flow', 'Rejection: the applicant is told why by e-mail and stays out', ['admin'], async (ctx) => {
    const h = ctx.helpers;
    const b = h.newApplicant('b');
    await h.registerAndVerify(b);
    const id = await h.findApplicantId(b);
    const reason = `Not found in the batch list (verification run ${ctx.runId})`;
    const reject = await ctx.http.post(`/api/admin/approvals/${id}/reject`, { reason }, { token: ctx.state.adminToken });
    must(reject.status === 200, `reject answered ${reject.status} ${reject.text.slice(0, 160)}`);
    const facts = ['rejected'];
    if (ctx.mail) {
      const mailed = await ctx.mail.waitFor({ to: b.email, subject: SUBJECT.rejected, timeoutMs: 60_000 });
      must(mailed.ok, `"${SUBJECT.rejected}" did not arrive within 60 s`);
      must(`${mailed.message?.Text ?? ''}${mailed.message?.HTML ?? ''}`.includes(ctx.runId), 'the rejection e-mail does not contain the reason');
      facts.push('mail with the reason');
    }
    const login = await ctx.http.post('/api/auth/login', { email: b.email, password: b.password });
    must(login.status === 403 && login.json?.error?.code === 'ACCOUNT_REJECTED', `rejected login answered ${login.status} ${login.json?.error?.code}`);
    must(!login.text.includes(ctx.runId), 'the API answer must not repeat the reason');
    facts.push('ACCOUNT_REJECTED without the reason');
    return { detail: facts.join('; ') };
  });

  gate('K03', 'kafka', 'The consumer has caught up: no message is waiting', ['kafka'], async (ctx) => {
    const lag = await ctx.helpers.groupLagZero(60_000);
    must(lag.ok, 'the consumer group still has lag after the registration flows');
    return { detail: `lag 0 over ${lag.value.rows.length} partition(s)`, files: [ctx.report.evidence('consumer-group-after-flows.txt', lag.value.raw)] };
  });

  // ---------------------------------------------------------------- drills (break things on purpose)
  gate('D01', 'drills', 'Broker outage: registration still works and everyone is still told (in-process fallback)', ['drills', 'kafka', 'mail', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const stop = await ctx.compose.stop('kafka');
    must(stop.code === 0, `cannot stop kafka: ${brief(stop)}`);
    ctx.state.kafkaStopped = true;
    const c = h.newApplicant('c');
    await h.register(c);
    must(c.registerMs < 10_000, `with the broker down registration took ${seconds(c.registerMs)}: it must not wait for Kafka`);
    await h.verifyEmail(c);
    const mails = await h.waitForRegistrationMails(c, 90_000);
    const notice = await h.waitForReviewNotice(c, 60_000);
    must(notice.ok, 'no in-app notice for the administrator while the broker is down');
    const down = await h.waitForHealth((body) => body.kafkaStatus === 'down', 90_000);
    must(down.ok, '/health never reported kafkaStatus "down" while the broker was stopped (it must not claim to be up)');
    return { detail: `register ${seconds(c.registerMs)}; mails in ${seconds(mails.totalMs)}; health says down after ${seconds(down.waitedMs)}` };
  });

  gate('D02', 'drills', 'Broker recovery: Kafka comes back, the next registration travels through it, no backlog remains', ['drills', 'kafka', 'mail', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const start = await ctx.compose.start('kafka');
    must(start.code === 0, `cannot start kafka: ${brief(start)}`);
    const healthy = await h.waitForServiceHealthy('kafka', 240_000);
    must(healthy.ok, 'kafka did not become healthy again within 4 minutes');
    ctx.state.kafkaStopped = false;
    const d = h.newApplicant('d');
    await h.registerAndVerify(d);
    const mails = await h.waitForRegistrationMails(d, 120_000);
    const up = await h.waitForHealth((body) => body.kafkaStatus === 'up', 180_000);
    must(up.ok, '/health did not return to kafkaStatus "up" after the broker came back');
    const lag = await h.groupLagZero(90_000);
    must(lag.ok, 'the consumer group still has lag after recovery');
    return { detail: `kafka healthy after ${seconds(healthy.waitedMs)}; mails in ${seconds(mails.totalMs)}; health up after ${seconds(up.waitedMs)}; lag 0` };
  });

  gate('D03', 'drills', 'Poison messages go to the dead-letter topic and the consumer keeps working', ['drills', 'kafka', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const main = `${ctx.config.prefix}.notifications`;
    const dlq = `${main}.dlq`;
    const garbage = `poison-not-json-${ctx.runId}`;
    const badType = JSON.stringify(h.kafkaEnvelope('does.not.exist', {}, `poison-${ctx.runId}`));
    const sent = await ctx.kafka.produce(main, [garbage, badType]);
    must(sent.code === 0, `cannot produce: ${brief(sent)}`);
    const landed = await until(async () => {
      const messages = await ctx.kafka.consume(dlq, { max: 100, timeoutMs: 8_000 });
      return messages.some((m) => m.includes(garbage)) && messages.some((m) => m.includes(`poison-${ctx.runId}`)) ? messages : null;
    }, { timeoutMs: 90_000, intervalMs: 2_000 });
    must(landed.ok, `both poison messages must reach ${dlq}`);
    const title = `verify-${ctx.runId}-after-poison`;
    const { userId, envelope } = await h.adminDeliver(title);
    const done = await ctx.kafka.produce(main, [JSON.stringify(envelope)], { key: userId });
    must(done.code === 0, `cannot produce: ${brief(done)}`);
    const arrived = await h.waitForNotice((n) => n.title === title, 60_000);
    must(arrived.ok, 'a valid event sent after the poison messages was not delivered: the consumer is stuck');
    return { detail: `2 poison messages dead-lettered; next valid event delivered after ${seconds(arrived.waitedMs)}`, files: [ctx.report.evidence('dead-letter-topic.txt', landed.value.join('\n'))] };
  });

  gate('D04', 'drills', 'The same event delivered twice produces one notification (idempotent)', ['drills', 'kafka', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const main = `${ctx.config.prefix}.notifications`;
    const title = `verify-${ctx.runId}-duplicate`;
    const { userId, envelope } = await h.adminDeliver(title);
    const line = JSON.stringify(envelope);
    const sent = await ctx.kafka.produce(main, [line, line], { key: userId });
    must(sent.code === 0, `cannot produce: ${brief(sent)}`);
    const first = await h.waitForNotice((n) => n.title === title, 60_000);
    must(first.ok, 'the event was not delivered');
    await sleep(12_000);
    const count = (await h.notices()).filter((n) => n.title === title).length;
    must(count === 1, `the duplicate event produced ${count} notifications, expected 1`);
    return { detail: 'delivered once' };
  });

  gate('D05', 'drills', 'Events sent while the API is down are delivered when it returns (committed offsets)', ['drills', 'kafka', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const main = `${ctx.config.prefix}.notifications`;
    const title = `verify-${ctx.runId}-while-api-down`;
    const { userId, envelope } = await h.adminDeliver(title);
    const stop = await ctx.compose.stop('api');
    must(stop.code === 0, `cannot stop the api: ${brief(stop)}`);
    const sent = await ctx.kafka.produce(main, [JSON.stringify(envelope)], { key: userId });
    must(sent.code === 0, `cannot produce while the api is down: ${brief(sent)}`);
    const start = await ctx.compose.start('api');
    must(start.code === 0, `cannot start the api: ${brief(start)}`);
    const back = await h.waitForServiceHealthy('api', 240_000);
    must(back.ok, 'the API did not become healthy again');
    const arrived = await h.waitForNotice((n) => n.title === title, 90_000);
    must(arrived.ok, 'the event sent while the API was down was never delivered');
    const count = (await h.notices()).filter((n) => n.title === title).length;
    must(count === 1, `delivered ${count} times, expected once`);
    return { detail: `api healthy after ${seconds(back.waitedMs)}; event delivered once` };
  });

  gate('D06', 'drills', 'Restarting Kafka and PostgreSQL loses nothing and the API recovers by itself', ['drills', 'kafka', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const main = `${ctx.config.prefix}.notifications`;
    const kafka = await ctx.compose.restart('kafka');
    must(kafka.code === 0, `cannot restart kafka: ${brief(kafka)}`);
    must((await h.waitForServiceHealthy('kafka', 240_000)).ok, 'kafka is not healthy after the restart');
    const topics = await ctx.kafka.listTopics();
    must(topics.includes(main) && topics.includes(`${main}.dlq`), 'the topics are gone after the broker restart (the data volume is not persistent)');
    const db = await ctx.compose.restart('postgres');
    must(db.code === 0, `cannot restart postgres: ${brief(db)}`);
    const healthy = await h.waitForHealth((body) => body.databaseStatus === 'up', 180_000);
    must(healthy.ok, 'the API did not reconnect to PostgreSQL after its restart');
    const me = await ctx.http.get('/api/auth/me', { token: ctx.state.adminToken });
    must(me.status === 200, `/auth/me answered ${me.status} after the database restart`);
    const a = ctx.state.applicantA;
    if (a) {
      const search = await ctx.http.get(`/api/admin/users?search=${encodeURIComponent(a.email)}`, { token: ctx.state.adminToken });
      must(search.json?.data?.some((u) => String(u.email).toLowerCase() === a.email), 'the applicant created before the restart is gone');
    }
    const rows = await ctx.compose.ps();
    const api = rows.find((r) => r.service === 'api');
    const inspect = await ctx.exec('docker', ['inspect', '-f', '{{.RestartCount}}', api.id]);
    return { detail: `topics intact; API reconnected after ${seconds(healthy.waitedMs)}; api restart count ${inspect.stdout.trim()}` };
  });

  gate('D07', 'drills', 'Redis outage: the API keeps serving, and Redis comes back', ['drills', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const stop = await ctx.compose.stop('redis');
    must(stop.code === 0, `cannot stop redis: ${brief(stop)}`);
    try {
      const health = await ctx.http.get('/health', { timeout: 10_000 });
      must(health.status === 200, `/health answered ${health.status} without Redis`);
      const landing = await ctx.http.get('/api/landing', { timeout: 10_000 });
      must(landing.status === 200, `/api/landing answered ${landing.status} without Redis`);
      const me = await ctx.http.get('/api/auth/me', { token: ctx.state.adminToken, timeout: 10_000 });
      must(me.status === 200, `/auth/me answered ${me.status} without Redis`);
    } finally {
      await ctx.compose.start('redis');
    }
    const back = await h.waitForHealth((body) => body.redisStatus === 'up', 120_000);
    must(back.ok, '/health did not return to redisStatus "up" after Redis came back');
    return { detail: `served without Redis; up again after ${seconds(back.waitedMs)}` };
  });

  gate('D08', 'drills', 'Backup and restore: a dump of the database restores into a scratch database with the same data', ['drills'], async (ctx) => {
    const db = ctx.envValues?.POSTGRES_DB ?? 'aiem_verify';
    const user = ctx.envValues?.POSTGRES_USER ?? 'aiem';
    const sh = async (script) => ctx.compose.execIn('postgres', ['sh', '-c', script], { timeoutMs: 180_000 });
    const count = async (database, sql) => {
      const result = await sh(`psql -U ${user} -d ${database} -tAc '${sql}'`);
      must(result.code === 0, `psql failed on ${database}: ${brief(result)}`);
      return Number(result.stdout.trim());
    };
    const users = await count(db, 'select count(*) from "User"');
    const tables = await count(db, "select count(*) from information_schema.tables where table_schema='public'");
    must(users >= 2, `only ${users} user(s) in the database: the earlier gates should have created some`);
    try {
      const dump = await sh(`pg_dump -U ${user} -Fc ${db} -f /tmp/verify.dump`);
      must(dump.code === 0, `pg_dump failed: ${brief(dump)}`);
      const create = await sh(`createdb -U ${user} aiem_restore`);
      must(create.code === 0, `createdb failed: ${brief(create)}`);
      const restore = await sh(`pg_restore -U ${user} -d aiem_restore --no-owner /tmp/verify.dump`);
      must(restore.code === 0, `pg_restore failed: ${brief(restore)}`);
      const restoredUsers = await count('aiem_restore', 'select count(*) from "User"');
      const restoredTables = await count('aiem_restore', "select count(*) from information_schema.tables where table_schema='public'");
      must(restoredUsers === users, `the restore has ${restoredUsers} users, the original ${users}`);
      must(restoredTables === tables, `the restore has ${restoredTables} tables, the original ${tables}`);
      return { detail: `${users} users and ${tables} tables restored into a scratch database` };
    } finally {
      await sh(`dropdb -U ${user} --if-exists aiem_restore; rm -f /tmp/verify.dump`);
    }
  });

  gate('D09', 'drills', 'docker compose down and up again (without -v) keeps the data', ['drills', 'kafka', 'admin'], async (ctx) => {
    const h = ctx.helpers;
    const down = await ctx.compose.down({ volumes: false });
    must(down.code === 0, `compose down failed: ${brief(down)}`);
    const up = await ctx.compose.up({ build: false, waitTimeoutSec: ctx.config.waitSec });
    must(up.code === 0, `compose up after down failed: ${brief(up)}`);
    const me = await ctx.http.get('/api/auth/me', { token: ctx.state.adminToken });
    must(me.status === 200, `the administrator session did not survive the restart (${me.status})`);
    const a = ctx.state.applicantA;
    if (a) {
      const login = await ctx.http.post('/api/auth/login', { email: a.email, password: a.password });
      must(login.status === 200, `the approved applicant can no longer sign in after down/up (${login.status})`);
    }
    const topics = await ctx.kafka.listTopics();
    must(topics.includes(`${ctx.config.prefix}.notifications`), 'the Kafka topics did not survive down/up');
    const group = await h.groupLagZero(90_000);
    must(group.ok, 'the consumer group did not come back with a clean backlog');
    return { detail: 'data, sessions, topics and consumer group intact' };
  });

  // ---------------------------------------------------------------- security-adjacent
  gate('X01', 'security', 'No secret value appears in any container log', ['stack', 'up'], async (ctx) => {
    const logs = await ctx.compose.logs(undefined, { tail: 4000 });
    const text = `${logs.stdout}\n${logs.stderr}`;
    const leaked = ctx.secrets.filter((secret) => secret && text.includes(secret)).length;
    ctx.report.evidence('all-container-logs.txt', text);
    must(leaked === 0, `${leaked} secret value(s) (database password, JWT secrets, admin password) appear in the container logs`);
    return { detail: `${text.split('\n').length} log lines scanned for ${ctx.secrets.length} secrets` };
  });

  gate('X02', 'security', 'The password-reset limiter engages after repeated requests from one address', [], async (ctx) => {
    // forgot-password has its own bucket (10 / 15 min) that nothing else in this suite or in the security probes uses
    const statuses = [];
    for (let i = 0; i < 14; i++) {
      const response = await ctx.http.post('/api/auth/forgot-password', { email: `nobody-${ctx.runId}-${i}@aiem.test` });
      statuses.push(response.status);
    }
    const firstLimited = statuses.findIndex((s) => s === 429);
    must(firstLimited !== -1, `14 requests in a row were never limited (${statuses.join(',')})`);
    must(firstLimited >= 8, `the limiter started too early: request ${firstLimited + 1} was already refused`);
    return { detail: `first 429 at request ${firstLimited + 1} of 14` };
  });

  gate('X03', 'security', 'The Kafka log shows no errors that are not explained by the drills', ['stack', 'up', 'kafka'], async (ctx) => {
    const logs = await ctx.compose.logs('kafka', { tail: 600 });
    const errors = `${logs.stdout}`.split('\n').filter((line) => /\bERROR\b|\bFATAL\b/.test(line));
    const file = ctx.report.evidence('kafka-errors.txt', errors.join('\n'));
    // Stopping and restarting the broker on purpose logs a few shutdown errors; a clean run has none after the last start
    const afterLastStart = errors.slice(-20);
    must(afterLastStart.length < 20, `${afterLastStart.length} ERROR lines in the recent broker log`);
    return { detail: `${errors.length} ERROR/FATAL line(s) in the last 600 (see evidence)`, files: [file] };
  });

  return gates;
};

/** Runs every gate in order and records each result. A blocking gate that fails stops the gates that need the stack. */
export const runGates = async (ctx, gates = buildGates()) => {
  const has = (need) => {
    switch (need) {
      case 'stack':
        return Boolean(ctx.compose);
      case 'up':
        return Boolean(ctx.state.stackUp) || !ctx.compose;
      case 'kafka':
        return Boolean(ctx.kafka) && ctx.state.kafkaEnabled !== false;
      case 'mail':
        return Boolean(ctx.mail);
      case 'drills':
        return Boolean(ctx.compose) && !ctx.config.skipDrills;
      case 'admin':
        return Boolean(ctx.state.adminToken);
      case 'web':
        return Boolean(ctx.web);
      default:
        return true;
    }
  };
  const why = {
    stack: 'Docker Compose is not controlling the stack (attach mode)',
    up: 'the stack did not start',
    kafka: 'Kafka is not available to this run',
    mail: 'no mail catcher is configured',
    drills: 'drills are off (--skip-drills) or the stack is not controlled by this run',
    admin: 'no administrator session',
    web: 'the web address is not known (--web)',
  };

  for (const g of gates) {
    if (ctx.state.stackFailed && !g.blocking) {
      ctx.report.record({ id: g.id, phase: g.phase, title: g.title, status: 'skip', detail: 'skipped: the stack did not start' });
      ctx.log(`SKIP  ${g.id}  ${g.title}  (the stack did not start)`);
      continue;
    }
    const missing = (g.needs ?? []).find((need) => !has(need));
    if (missing) {
      ctx.report.record({ id: g.id, phase: g.phase, title: g.title, status: 'skip', detail: `skipped: ${why[missing]}` });
      ctx.log(`SKIP  ${g.id}  ${g.title}  (${why[missing]})`);
      continue;
    }
    const started = Date.now();
    try {
      const result = (await g.run(ctx)) ?? {};
      ctx.report.record({ id: g.id, phase: g.phase, title: g.title, status: 'pass', detail: result.detail ?? '', ms: Date.now() - started, files: result.files ?? [] });
      ctx.log(`PASS  ${g.id}  ${g.title}${result.detail ? `  (${result.detail})` : ''}`);
    } catch (error) {
      ctx.report.record({ id: g.id, phase: g.phase, title: g.title, status: 'fail', detail: String(error?.message ?? error), ms: Date.now() - started, files: error?.files ?? [] });
      ctx.log(`FAIL  ${g.id}  ${g.title}  (${String(error?.message ?? error).slice(0, 300)})`);
      if (g.blocking) ctx.state.stackFailed = true;
    }
  }
};
