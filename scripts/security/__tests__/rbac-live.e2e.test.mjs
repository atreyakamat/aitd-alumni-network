// End to end: the real rbac-live.mjs (as a child process) against a fake API on a local port.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadApiReference } from '../lib/api-reference.mjs';
import { buildPlan, isDenylisted } from '../lib/probe-plan.mjs';
import { startFakeApi } from './helpers/fake-api.mjs';

const exec = promisify(execFile);
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'rbac-live.mjs');
const { endpoints } = await loadApiReference();

const FAST = ['--delay-ms', '0', '--budget', '1000000', '--safety', '0', '--max-minutes', '3', '--quiet'];
const ALL_ACCOUNTS = [
  '--admin-email', 'admin@fake.test', '--admin-password', 'pw',
  '--member-email', 'member@fake.test', '--member-password', 'pw',
  '--plain-admin-email', 'plain@fake.test', '--plain-admin-password', 'pw',
];

/** Run the probe against a fake; returns exit code, output and the parsed JSON report. */
async function probe(fake, extra = []) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rbac-e2e-'));
  const out = path.join(dir, 'report.json');
  try {
    const result = await exec(process.execPath, [script, '--api', fake.api, ...ALL_ACCOUNTS, ...FAST, '--out', out, ...extra], { maxBuffer: 64 * 1024 * 1024 }).then(
      (r) => ({ code: 0, ...r }),
      (e) => ({ code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' })
    );
    let report = null;
    try {
      report = JSON.parse(await readFile(out, 'utf8'));
    } catch {
      /* no report (usage error) */
    }
    return { ...result, report, text: `${result.stdout}\n${result.stderr}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a correct API passes every assertion, and the JSON report holds no credentials', async () => {
  const fake = await startFakeApi(endpoints);
  try {
    const run = await probe(fake);
    assert.equal(run.code, 0, run.text);
    assert.match(run.stdout, /PASS: 0 failing assertions/);
    assert.equal(run.report.summary.failed, 0);
    assert.equal(run.report.summary.notRun, 0);
    assert.equal(run.report.summary.exitCode, 0);

    // the table covers all five assertions
    const by = run.report.summary.byAssertion;
    for (const key of ['A', 'B', 'C', 'D', 'E']) assert.ok(by[key].pass > 0, `assertion ${key} ran`);
    assert.equal(by.D.fail, 0);

    // the plan that was executed is the plan the planner builds
    const plan = buildPlan(endpoints, { identities: [{ name: 'visitor', rank: -1 }, { name: 'member', rank: 0 }, { name: 'admin', rank: 3 }, { name: 'plain-admin', rank: 2, breadth: 'refusals' }] });
    assert.equal(run.report.summary.planned, plan.items.length);
    assert.equal(run.report.notSent.total, plan.skipped.length);

    // nothing secret in the report
    const text = JSON.stringify(run.report);
    assert.ok(!/tok-[A-Z_]+-[0-9]|ref-[A-Z_]+-[0-9]|"pw"|Bearer/.test(text), 'no tokens or passwords in the report');
    assert.deepEqual(run.report.identities.map((i) => `${i.name}:${i.role}`), ['admin:SUPER_ADMIN', 'member:MEMBER', 'plain-admin:ADMIN']);
    // one login per identity
    assert.equal(fake.stats.logins, 3);
  } finally {
    await fake.close();
  }
});

test('a route that answers 500 and a route that lets a visitor through are both reported as failures', async () => {
  const fake = await startFakeApi(endpoints, {
    broken500: ['GET /users/:id/followers'],
    leaky: ['GET /news/latest'],
    plainAdminLeak: true,
  });
  try {
    const run = await probe(fake);
    assert.equal(run.code, 1, run.text);
    assert.match(run.stdout, /FAIL: \d+ failing assertions/);
    const failures = run.report.failures;

    const leak = failures.find((f) => f.identity === 'visitor' && f.path === '/news/latest');
    assert.ok(leak, 'the visitor leak is reported');
    assert.equal(leak.status, 200);
    assert.equal(leak.assertion, 'A');
    assert.match(leak.problem, /expected 401 .* got 200/);

    const crash = failures.filter((f) => f.path === '/users/:id/followers');
    assert.ok(crash.length >= 1, 'the 500 is reported');
    for (const f of crash) {
      assert.equal(f.status, 500);
      assert.match(f.problem, /server error 500/);
    }
    assert.ok(run.report.summary.byAssertion.D.fail >= 1, 'assertion D counts the 5xx');

    const plain = failures.find((f) => f.identity === 'plain-admin');
    assert.ok(plain, 'a plain admin that is not refused on a super-admin route is reported');
    assert.equal(plain.assertion, 'C');

    // the details are printed too
    assert.match(run.stdout, /visitor GET \/news\/latest/);
    assert.match(run.stdout, /GET \/users\/:id\/followers/);
    // and the response is described by shape/code only
    assert.ok(!JSON.stringify(failures).includes('"data":[]'));
  } finally {
    await fake.close();
  }
});

test('a member who is not refused on an admin route (or gets 400/404 instead of 403) fails assertion B', async () => {
  // the fake lets a member through on one admin route by marking it public in a copy of the reference
  const doctored = endpoints.map((e) => (e.method === 'GET' && e.path === '/admin/users' ? { ...e, access: 'member' } : e));
  const fake = await startFakeApi(doctored);
  try {
    const run = await probe(fake);
    assert.equal(run.code, 1, run.text);
    const failure = run.report.failures.find((f) => f.path === '/admin/users' && f.identity === 'member');
    assert.ok(failure);
    assert.equal(failure.assertion, 'B');
    assert.match(failure.problem, /expected 403/);
  } finally {
    await fake.close();
  }
});

test('on the wire: no denylisted route is ever called with a token, and writes only go where they must be refused', async () => {
  for (const unsafe of [false, true]) {
    const fake = await startFakeApi(endpoints);
    try {
      const run = await probe(fake, unsafe ? ['--unsafe'] : []);
      assert.equal(run.code, 0, run.text);
      const withToken = fake.wire.filter((w) => w.role && w.path !== '/auth/login' && w.path !== '/auth/refresh-token');
      assert.ok(withToken.length > 100);

      for (const w of withToken) {
        // the denylist, spelled out independently of the planner's own matcher
        assert.ok(!/^\/auth\/(logout|change-password|2fa)/.test(w.path), `${w.method} ${w.path}`);
        assert.ok(!/^\/(payments|donations)(\/|$)/.test(w.path), `${w.method} ${w.path}`);
        assert.ok(w.path !== '/users/me/export', `${w.method} ${w.path}`);
        assert.ok(!(w.method === 'DELETE' && w.path === '/users/me'), `${w.method} ${w.path}`);
        assert.ok(w.path !== '/admin/audit/cleanup', `${w.method} ${w.path}`);
        assert.equal(isDenylisted(w.method, w.path), false);
      }

      // every mutating request with a token went to a route that must refuse it (admin-level route as a member, super-admin route as plain admin)
      const adminLevel = (method, p) => endpoints.some((e) => e.method === method && (e.access === 'chapter-admin' || e.access === 'admin' || e.access === 'super-admin') && new RegExp(`^${e.path.replace(/:[A-Za-z]+/g, '[^/]+')}$`).test(p));
      for (const w of withToken.filter((x) => x.method !== 'GET')) {
        if (unsafe && w.role === 'MEMBER' && !adminLevel(w.method, w.path)) {
          assert.deepEqual(w.body, {}, 'unsafe member writes carry an empty body');
          continue;
        }
        assert.ok(adminLevel(w.method, w.path), `${w.role} ${w.method} ${w.path} is not an admin-level route`);
        assert.ok(w.role === 'MEMBER' || w.role === 'ADMIN', `${w.role} sent a write`);
        assert.deepEqual(w.body, {});
        assert.ok(/00000000-0000-4000-8000-000000000000/.test(w.path) || !/:/.test(w.path) , 'nonexistent id');
      }
      // super admin only ever reads
      assert.ok(withToken.filter((w) => w.role === 'SUPER_ADMIN').every((w) => w.method === 'GET'));
      // an unsafe run sends strictly more
      if (unsafe) assert.ok(withToken.some((w) => w.role === 'MEMBER' && w.method !== 'GET' && !adminLevel(w.method, w.path)), 'unsafe adds member-level writes');
      else assert.ok(!withToken.some((w) => w.role === 'MEMBER' && w.method !== 'GET' && !adminLevel(w.method, w.path)));
    } finally {
      await fake.close();
    }
  }
});

test('visitors are sent the denylisted routes (the answer must be 401), members and admins never', async () => {
  const fake = await startFakeApi(endpoints);
  try {
    const run = await probe(fake);
    assert.equal(run.code, 0, run.text);
    const visitor = fake.wire.filter((w) => w.role === null);
    assert.ok(visitor.some((w) => w.method === 'POST' && w.path === '/auth/logout'));
    assert.ok(visitor.some((w) => w.method === 'POST' && w.path === '/admin/audit/cleanup'));
  } finally {
    await fake.close();
  }
});

test('a 429 is retried and never counted as a pass or a fail', async () => {
  const fake = await startFakeApi(endpoints, { rateLimitOnce: 'GET /search' });
  try {
    const run = await probe(fake);
    assert.equal(run.code, 0, run.text);
    assert.equal(run.report.rateLimit.rateLimited, 1);
    assert.ok(run.report.rateLimit.waitedSeconds >= 1);
    assert.equal(run.report.results.filter((r) => r.status === 429).length, 0);
    assert.equal(run.report.summary.failed, 0);
  } finally {
    await fake.close();
  }
});

test('an access token that stops working mid-run is renewed once with the refresh token (no second login)', async () => {
  const fake = await startFakeApi(endpoints, { expireMemberAfter: 250 });
  try {
    const run = await probe(fake, ['--renew-gap-ms', '0']);
    assert.equal(run.code, 0, run.text);
    assert.equal(fake.state.expired, true, 'the fake did expire the token');
    assert.equal(fake.stats.refreshes, 1);
    assert.equal(fake.stats.logins, 3, 'one login per identity, no re-login');
  } finally {
    await fake.close();
  }
});

test('if the session cannot be renewed the remaining calls are NOT RUN and the probe fails (no silent pass)', async () => {
  const fake = await startFakeApi(endpoints, { expireMemberAfter: 250 });
  // make every refresh fail
  fake.state.refresh.clear();
  const originalSet = fake.state.refresh.set.bind(fake.state.refresh);
  fake.state.refresh.set = () => originalSet; // refresh tokens are never stored: refresh answers 401
  try {
    const run = await probe(fake, ['--renew-gap-ms', '0']);
    assert.equal(run.code, 1, run.text);
    assert.ok(run.report.summary.notRun > 0);
    assert.match(run.stdout, /NOT RUN/);
    assert.equal(fake.stats.logins, 3, 'it did not sign in again');
  } finally {
    await fake.close();
  }
});

test('without a member or plain-admin account the related assertions are not planned', async () => {
  const fake = await startFakeApi(endpoints);
  try {
    const dir = await mkdtemp(path.join(tmpdir(), 'rbac-e2e-'));
    const out = path.join(dir, 'r.json');
    try {
      const r = await exec(process.execPath, [script, '--api', fake.api, '--admin-email', 'admin@fake.test', '--admin-password', 'pw', ...FAST, '--out', out]);
      assert.match(r.stdout, /No member account given/);
      assert.match(r.stdout, /No plain-admin account given/);
      const report = JSON.parse(await readFile(out, 'utf8'));
      assert.equal(report.summary.byAssertion.B.pass + report.summary.byAssertion.B.fail, 0);
      assert.equal(report.summary.byAssertion.C.pass + report.summary.byAssertion.C.fail, 0);
      assert.ok(report.summary.byAssertion.A.pass > 100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    await fake.close();
  }
});

test('credentials can come from a file; passwords never need to be on the command line', async () => {
  const fake = await startFakeApi(endpoints);
  const dir = await mkdtemp(path.join(tmpdir(), 'rbac-creds-'));
  try {
    const file = path.join(dir, 'credentials.json');
    await writeFile(file, JSON.stringify({ adminEmail: 'admin@fake.test', adminPassword: 'pw', memberEmail: 'member@fake.test', memberPassword: 'pw' }));
    const r = await exec(process.execPath, [script, '--api', fake.api, '--credentials-file', file, ...FAST]);
    assert.match(r.stdout, /PASS/);
    assert.equal(fake.stats.logins, 2);
  } finally {
    await fake.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('usage and safety errors exit 2 before any request is sent', async () => {
  const fail = (args) => exec(process.execPath, [script, ...args]).then(() => ({ code: 0 }), (e) => ({ code: e.code, stderr: e.stderr }));

  assert.equal((await fail([])).code, 2);
  const noAdmin = await fail(['--api', 'http://127.0.0.1:9/api']);
  assert.equal(noAdmin.code, 2);
  assert.match(noAdmin.stderr, /administrator account is required/);

  const remote = await fail(['--api', 'https://www.example.edu/api', '--admin-email', 'a@b.c', '--admin-password', 'x']);
  assert.equal(remote.code, 2);
  assert.match(remote.stderr, /does not look like a test stack/);

  const half = await fail(['--api', 'http://127.0.0.1:9/api', '--admin-email', 'a@b.c', '--admin-password', 'x', '--member-email', 'm@b.c']);
  assert.equal(half.code, 2);
  assert.match(half.stderr, /must be given together/);

  const badUrl = await fail(['--api', 'ftp://x/api', '--admin-email', 'a@b.c', '--admin-password', 'x']);
  assert.equal(badUrl.code, 2);

  const unreachable = await fail(['--api', 'http://127.0.0.1:9/api', '--admin-email', 'a@b.c', '--admin-password', 'x', '--quiet']);
  assert.equal(unreachable.code, 2);
  assert.match(unreachable.stderr, /not reachable/);
});

test('wrong credentials stop the run with exit 2 and a clear message', async () => {
  const fake = await startFakeApi(endpoints);
  try {
    const r = await exec(process.execPath, [script, '--api', fake.api, '--admin-email', 'admin@fake.test', '--admin-password', 'WRONG', ...FAST]).then(() => ({ code: 0 }), (e) => ({ code: e.code, stderr: e.stderr }));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /login failed for admin/);
    assert.ok(!r.stderr.includes('WRONG'), 'the password is never echoed');
    assert.equal(fake.stats.logins, 1);
  } finally {
    await fake.close();
  }
});

test('a member account with a higher role than MEMBER is rejected as the member identity', async () => {
  const fake = await startFakeApi(endpoints);
  try {
    const r = await exec(process.execPath, [script, '--api', fake.api, '--admin-email', 'admin@fake.test', '--admin-password', 'pw', '--member-email', 'plain@fake.test', '--member-password', 'pw', ...FAST]).then(() => ({ code: 0 }), (e) => ({ code: e.code, stderr: e.stderr }));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /must be a plain MEMBER/);
  } finally {
    await fake.close();
  }
});
