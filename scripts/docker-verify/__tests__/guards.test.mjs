// Guards that keep the verification suite, the compose files, the server and the workflow consistent with each other.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { makeEnv } from '../lib/envfile.mjs';
import { SUBJECT, OFFICE_MAILBOX, buildGates } from '../gates.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');
const yaml = createRequire(import.meta.url)(path.join(REPO, 'node_modules', 'js-yaml'));
const load = (file) => yaml.load(read(file));

const base = load('docker-compose.yml');
const overlay = load('docker-compose.test.yml');
const workflow = load('.github/workflows/docker-verify.yml');

describe('the gates stay true to the server', () => {
  test('every e-mail subject a gate waits for is a subject the server really sends', () => {
    const email = read('server/src/utils/email.ts');
    for (const subject of [SUBJECT.verify, SUBJECT.received, SUBJECT.approved, SUBJECT.rejected]) {
      assert.ok(email.includes(`'${subject}'`), `server/src/utils/email.ts does not send "${subject}"`);
    }
    assert.ok(email.includes('`New registration to review: ${'), 'the "New registration to review: <name>" subject changed');
    assert.ok(SUBJECT.adminNew === 'New registration to review');
  });

  test('the Kafka defaults the gates assume are the server defaults (topic prefix, consumer group, partitions)', () => {
    const kafka = read('server/src/config/kafka.ts');
    assert.match(kafka, /\|\| 'aiem'/, 'default topic prefix');
    assert.match(kafka, /'aiem-notifications'/, 'default consumer group');
    const env = makeEnv();
    assert.equal(env.values.KAFKA_TOPIC_PREFIX, 'aiem');
    assert.equal(env.values.KAFKA_PARTITIONS, '3');
  });

  test('the registration events and the notification type the drills publish exist', () => {
    const events = read('server/src/services/notificationEvents.ts');
    for (const type of ['notification.deliver', 'registration.submitted', 'registration.received', 'registration.approved', 'registration.rejected']) assert.ok(events.includes(`'${type}'`), type);
    assert.match(read('server/prisma/schema.prisma'), /enum NotificationType \{[\s\S]*ADMIN_ANNOUNCEMENT[\s\S]*REGISTRATION_PENDING/);
  });

  test('the routes the gates call are in the API reference', () => {
    const api = read('docs/API_REFERENCE.md');
    for (const route of ['/auth/register', '/auth/verify-email', '/auth/login', '/auth/me', '/auth/forgot-password', '/admin/approvals', '/admin/system-status', '/notifications', '/admin/users', '/landing']) {
      assert.ok(api.includes(`\`${route}\``) || api.includes(`\`${route}/`), `${route} is not in docs/API_REFERENCE.md`);
    }
  });

  test('the shared mailbox the gates expect is the one the overlay configures', () => {
    assert.equal(overlay.services.api.environment.APPROVAL_NOTIFY_EMAIL, OFFICE_MAILBOX);
  });
});

describe('the generated env file covers what compose requires and uses', () => {
  const baseText = read('docker-compose.yml') + read('docker-compose.test.yml');

  test('every ${VAR:?} the base file demands is generated', () => {
    const required = [...baseText.matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1]);
    assert.ok(required.length >= 3);
    const values = makeEnv().values;
    for (const name of required) assert.ok(values[name], `${name} is required by docker-compose.yml but not generated`);
  });

  test('every host-port variable is generated, so the suite can move the stack to other ports', () => {
    const values = makeEnv({ proxyPort: 8080, webPort: 3100, apiPort: 5100, postgresPort: 55432, mailpitPort: 8125 }).values;
    for (const name of ['PROXY_HOST_PORT', 'WEB_HOST_PORT', 'API_HOST_PORT', 'POSTGRES_HOST_PORT', 'MAILPIT_UI_PORT']) {
      assert.ok(baseText.includes(name), `${name} is not used by the compose files`);
      assert.ok(values[name], `${name} is not generated`);
    }
    assert.equal(values.PROXY_HOST_PORT, '8080');
    assert.equal(values.MAILPIT_UI_PORT, '8125');
  });
});

describe('docker-compose.test.yml is a safe overlay', () => {
  test('adds exactly the mail catcher, pinned, published on this machine only', () => {
    assert.deepEqual(Object.keys(overlay.services).sort(), ['api', 'mailpit']);
    const { image, ports } = overlay.services.mailpit;
    assert.match(image, /^axllent\/mailpit:v\d+\.\d+\.\d+$/, 'pin an exact version, never latest');
    assert.ok(ports.every((p) => String(p).startsWith('127.0.0.1:')), 'the mail catcher UI/API must not be reachable from the network');
  });

  test('points the API at it, with verification on, as in production', () => {
    const env = overlay.services.api.environment;
    assert.equal(env.SMTP_HOST, 'mailpit');
    assert.equal(env.REQUIRE_EMAIL_VERIFICATION, 'true');
    assert.equal(env.REQUIRE_ADMIN_2FA, 'false', 'the scripted administrator login has no inbox for the code');
    assert.equal(env.ALLOW_INSECURE_PRODUCTION_CONFIG, 'true');
    assert.equal(overlay.services.api.depends_on.mailpit.condition, 'service_started');
  });

  test('does not publish Kafka, Redis or PostgreSQL, and does not touch the base services other than the API', () => {
    for (const name of Object.keys(overlay.services)) assert.ok(['api', 'mailpit'].includes(name));
    assert.equal(overlay.services.kafka, undefined);
    assert.equal(overlay.services.redis, undefined);
    assert.ok(!base.services.kafka.ports && !base.services.redis.ports, 'the base file keeps Kafka and Redis unpublished');
  });

  test('uses networks and log rotation the base file defines', () => {
    assert.deepEqual(overlay.services.mailpit.networks, ['backend']);
    assert.ok(base.networks.backend !== undefined);
    assert.equal(overlay.services.mailpit.logging.driver, 'json-file');
  });
});

describe('the CI workflow', () => {
  const jobs = workflow.jobs;

  test('every action is pinned to a version tag and permissions are minimal', () => {
    assert.deepEqual(workflow.permissions, { contents: 'read' });
    const uses = Object.values(jobs).flatMap((job) => job.steps.filter((step) => step.uses).map((step) => step.uses));
    assert.ok(uses.length > 0);
    for (const action of uses) assert.match(action, /^[\w.-]+\/[\w.-]+@v\d+(\.\d+){0,2}$/, `${action} must be pinned to a version tag`);
  });

  test('every job has a timeout', () => {
    for (const [name, job] of Object.entries(jobs)) assert.ok(Number(job['timeout-minutes']) > 0, `${name} has no timeout-minutes`);
  });

  test('the scripts it runs exist', () => {
    const text = read('.github/workflows/docker-verify.yml');
    for (const file of [...text.matchAll(/scripts\/[\w./*-]+\.(?:mjs|sh)/g)].map((m) => m[0]).filter((f) => !f.includes('*'))) {
      assert.ok(fs.existsSync(path.join(REPO, file)), `${file} is referenced by the workflow but missing`);
    }
  });

  test('the evidence is uploaded WITHOUT the private folder (test credentials), and the stack is removed even after a failure', () => {
    const steps = jobs.stack.steps;
    const upload = steps.find((step) => step.uses?.startsWith('actions/upload-artifact'));
    assert.ok(upload.if === 'always()');
    assert.match(upload.with.path, /!verify-report\/private\/\*\*/);
    const down = steps[steps.length - 1];
    assert.equal(down.if, 'always()');
    assert.match(down.run, /--down/);
  });

  test('the stack job waits for the script tests', () => {
    assert.equal(jobs.stack.needs, 'scripts');
  });
});

describe('the gate list', () => {
  test('ids are unique, each belongs to a known phase and says what it needs', () => {
    const gates = buildGates();
    assert.equal(new Set(gates.map((g) => g.id)).size, gates.length);
    for (const g of gates) {
      assert.ok(['preflight', 'stack', 'app', 'kafka', 'flow', 'drills', 'security'].includes(g.phase), `${g.id} phase`);
      assert.ok(Array.isArray(g.needs), `${g.id} needs`);
      assert.ok(g.title.length > 15, `${g.id} title`);
    }
    assert.equal(gates.filter((g) => g.blocking).map((g) => g.id).join(','), 'P01,P03,S02');
  });

  test('drills are the only gates that break the stack, and the order puts them after the normal flows', () => {
    const gates = buildGates();
    const firstDrill = gates.findIndex((g) => g.phase === 'drills');
    assert.ok(gates.slice(0, firstDrill).every((g) => g.phase !== 'drills'));
    assert.ok(gates.filter((g) => g.phase === 'drills').every((g) => g.needs.includes('drills')));
  });
});
