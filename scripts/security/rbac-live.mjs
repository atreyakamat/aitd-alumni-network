#!/usr/bin/env node
// Live authorization probe (round 3, phase C of docs/SECURITY_AUDIT_PLAN.md).
//
// Replays the DOCUMENTED access level of every endpoint in docs/API_REFERENCE.md against a RUNNING stack and checks that
// the API enforces it:
//   A  a visitor (no token) on any non-public, non-optional endpoint gets 401
//   B  a member on chapter-admin / admin / super-admin endpoints gets 403
//   C  a plain ADMIN (only when given) on super-admin endpoints gets 403
//   D  no request by any identity gets a 5xx (a 5xx on a syntactically valid, nonexistent id is a finding)
//   E  signed-in identities are not refused on the routes they are entitled to (GET only)
//
// Safety: see lib/probe-plan.mjs. Mutating requests are only sent as a visitor, or as a member / plain admin to routes that
// must refuse them before any handler, always with the nonexistent id and an empty body. A denylist (logout, password change,
// 2FA, account deletion/export, payments, donations, audit cleanup) is never called with a real identity, even with --unsafe.
//
// Usage:
//   node scripts/security/rbac-live.mjs --api http://localhost:5050/api \
//        --admin-email E --admin-password P [--member-email E --member-password P] \
//        [--plain-admin-email E --plain-admin-password P] [--out rbac-report.json] [--unsafe]
//   or  --credentials-file verify-report/private/credentials.json   (keys adminEmail, adminPassword, memberEmail, memberPassword,
//                                                                    plainAdminEmail, plainAdminPassword)
//   Passwords can also come from RBAC_ADMIN_PASSWORD, RBAC_MEMBER_PASSWORD, RBAC_PLAIN_ADMIN_PASSWORD (not visible in `ps`).
//   Pacing: --delay-ms 250  --budget 300  --window-seconds 900  --safety 6  --max-minutes 30  (--renew-gap-ms 30000: minimum time between token renewals)
//   A host that does not look like a test stack needs --allow-remote (see lib/target-guard.mjs).
//
// Exit codes: 0 all assertions passed, 1 at least one failure (or calls that could not be run), 2 usage / sign-in problem.
// Zero dependencies, Node 20+.

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadApiReference, countByLevel } from './lib/api-reference.mjs';
import { buildPlan, evaluate, summariseSkipped, NONEXISTENT_UUID } from './lib/probe-plan.mjs';
import { createClient, DeadlineError } from './lib/http-client.mjs';
import { Session, describeBody } from './lib/session.mjs';
import { isLikelyTestHost } from './lib/target-guard.mjs';

const OPTIONS = {
  api: { type: 'string' },
  'admin-email': { type: 'string' },
  'admin-password': { type: 'string' },
  'member-email': { type: 'string' },
  'member-password': { type: 'string' },
  'plain-admin-email': { type: 'string' },
  'plain-admin-password': { type: 'string' },
  'credentials-file': { type: 'string' },
  out: { type: 'string' },
  reference: { type: 'string' },
  unsafe: { type: 'boolean', default: false },
  'allow-remote': { type: 'boolean', default: false },
  'delay-ms': { type: 'string', default: '250' },
  budget: { type: 'string', default: '300' },
  'window-seconds': { type: 'string', default: '900' },
  safety: { type: 'string', default: '6' },
  'max-minutes': { type: 'string', default: '30' },
  'renew-gap-ms': { type: 'string', default: '30000' },
  quiet: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

const USAGE = `Usage: node scripts/security/rbac-live.mjs --api <http://host/api> --admin-email E --admin-password P
         [--member-email E --member-password P] [--plain-admin-email E --plain-admin-password P]
         [--credentials-file file.json] [--out rbac-report.json] [--unsafe] [--allow-remote]
         [--delay-ms 250] [--budget 300] [--window-seconds 900] [--safety 6] [--max-minutes 30] [--renew-gap-ms 30000] [--quiet]`;

const ASSERTION_TITLES = {
  A: 'A  visitor gets 401 on every non-public route',
  B: 'B  member gets 403 on admin-level routes',
  C: 'C  plain admin gets 403 on super-admin routes',
  D: 'D  no request gets a 5xx',
  E: 'E  entitled identities are not refused (GET)',
};

const positiveInt = (value, name) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
};

/** Merge flags, a credentials file and the environment into one credentials object. */
async function resolveCredentials(values) {
  let file = {};
  if (values['credentials-file']) {
    try {
      file = JSON.parse(await readFile(values['credentials-file'], 'utf8'));
    } catch (error) {
      throw new Error(`cannot read --credentials-file ${values['credentials-file']}: ${error.message}`);
    }
  }
  const pick = (flag, fileKey, env) => values[flag] ?? file[fileKey] ?? (env ? process.env[env] : undefined);
  return {
    admin: { email: pick('admin-email', 'adminEmail'), password: pick('admin-password', 'adminPassword', 'RBAC_ADMIN_PASSWORD') },
    member: { email: pick('member-email', 'memberEmail'), password: pick('member-password', 'memberPassword', 'RBAC_MEMBER_PASSWORD') },
    plainAdmin: {
      email: pick('plain-admin-email', 'plainAdminEmail'),
      password: pick('plain-admin-password', 'plainAdminPassword', 'RBAC_PLAIN_ADMIN_PASSWORD'),
    },
  };
}

const pad = (text, width) => String(text).padEnd(width);

export async function run(argv, io = {}) {
  const log = io.log ?? ((line) => console.log(line));
  const error = io.error ?? ((line) => console.error(line));

  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }));
  } catch (e) {
    error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (values.help) {
    log(USAGE);
    return 0;
  }

  // ---- arguments -------------------------------------------------------------------------------------------------
  let creds;
  let numbers;
  try {
    creds = await resolveCredentials(values);
    numbers = {
      delayMs: positiveInt(values['delay-ms'], 'delay-ms'),
      budget: positiveInt(values.budget, 'budget'),
      windowSeconds: positiveInt(values['window-seconds'], 'window-seconds'),
      safety: positiveInt(values.safety, 'safety'),
      maxMinutes: positiveInt(values['max-minutes'], 'max-minutes'),
      renewGapMs: positiveInt(values['renew-gap-ms'], 'renew-gap-ms'),
    };
  } catch (e) {
    error(`${e.message}\n${USAGE}`);
    return 2;
  }
  if (!values.api) {
    error(`--api is required\n${USAGE}`);
    return 2;
  }
  let apiUrl;
  try {
    apiUrl = new URL(values.api);
    if (apiUrl.protocol !== 'http:' && apiUrl.protocol !== 'https:') throw new Error('not http(s)');
  } catch {
    error(`--api must be an http(s) URL such as http://localhost:5050/api (got "${values.api}")`);
    return 2;
  }
  const base = apiUrl.href.replace(/\/+$/, '');
  if (!isLikelyTestHost(apiUrl.hostname) && !values['allow-remote']) {
    error(`Refusing to probe ${apiUrl.hostname}: it does not look like a test stack (localhost, a private or tailnet address, a single-label host name).\n` +
      'This probe signs in and sends hundreds of requests; run it only against the audit test stack. Pass --allow-remote if you really own this target and it carries test data only.');
    return 2;
  }
  if (!creds.admin.email || !creds.admin.password) {
    error(`an administrator account is required (--admin-email/--admin-password or --credentials-file)\n${USAGE}`);
    return 2;
  }
  for (const [label, c] of [['member', creds.member], ['plain-admin', creds.plainAdmin]]) {
    if (Boolean(c.email) !== Boolean(c.password)) {
      error(`--${label}-email and --${label}-password must be given together`);
      return 2;
    }
  }

  const startedAt = new Date();
  const deadlineAt = Date.now() + numbers.maxMinutes * 60_000;
  const progress = values.quiet ? () => {} : (line) => log(line);
  const client = createClient({
    base,
    minIntervalMs: numbers.delayMs,
    budget: numbers.budget,
    windowMs: numbers.windowSeconds * 1000,
    safety: numbers.safety,
    deadlineAt,
    log: progress,
  });

  // ---- the documented access levels -------------------------------------------------------------------------------
  const reference = await loadApiReference(values.reference);
  const endpoints = reference.endpoints;
  log(`Target ${base}`);
  log(`Reference: ${endpoints.length} documented endpoints ${JSON.stringify(countByLevel(endpoints))}`);
  if (reference.statedTotal !== null && reference.statedTotal !== endpoints.length) {
    error(`API reference parse mismatch: the document says ${reference.statedTotal} endpoints, the parser found ${endpoints.length}`);
    return 2;
  }

  // ---- reachability (the health route sits outside the rate-limited /api prefix) -----------------------------------
  try {
    const health = await fetch(`${apiUrl.origin}/health`, { signal: AbortSignal.timeout(15_000) });
    log(`Health: HTTP ${health.status}`);
  } catch (e) {
    error(`The API is not reachable at ${apiUrl.origin}: ${e?.cause?.code ?? e.message}`);
    return 2;
  }

  // ---- sign in, once per identity -----------------------------------------------------------------------------------
  const sessions = new Map(); // name -> Session
  const identityRows = [];
  const signIn = async (name, c, check) => {
    const session = new Session({ name, email: c.email, password: c.password, client, log: progress, minRenewGapMs: numbers.renewGapMs });
    let failure;
    try {
      failure = await session.login();
    } catch (e) {
      failure = e instanceof DeadlineError ? e.message : `login failed: ${e.message}`;
    }
    if (!failure) failure = check(session);
    if (failure) {
      error(failure);
      return false;
    }
    sessions.set(name, session);
    identityRows.push({ name, role: session.role, rank: session.rank });
    log(`Signed in ${name} as ${session.role}`);
    return true;
  };

  if (!(await signIn('admin', creds.admin, (s) => (s.rank >= 2 ? null : `--admin account has role ${s.role}; an ADMIN or SUPER_ADMIN is required`)))) return 2;
  if (creds.member.email && !(await signIn('member', creds.member, (s) => (s.rank === 0 ? null : `--member account has role ${s.role}; it must be a plain MEMBER`)))) return 2;
  if (creds.plainAdmin.email && !(await signIn('plain-admin', creds.plainAdmin, (s) => (s.role === 'ADMIN' ? null : `--plain-admin account has role ${s.role}; it must be exactly ADMIN`)))) return 2;
  if (!creds.member.email) log('No member account given: assertions B and the member part of E are not run.');
  if (!creds.plainAdmin.email) log('No plain-admin account given: assertion C is not run (only a SUPER_ADMIN would be allowed on those routes).');

  // ---- plan ------------------------------------------------------------------------------------------------------------
  const identities = [{ name: 'visitor', rank: -1 }];
  if (sessions.has('member')) identities.push({ name: 'member', rank: 0 });
  identities.push({ name: 'admin', rank: sessions.get('admin').rank });
  if (sessions.has('plain-admin')) identities.push({ name: 'plain-admin', rank: 2, breadth: 'refusals' });
  const { items, skipped } = buildPlan(endpoints, { identities, unsafe: values.unsafe });
  log(`Plan: ${items.length} requests (${skipped.length} documented calls deliberately not sent)${values.unsafe ? ' [--unsafe]' : ''}`);
  log(`Pacing: ${numbers.delayMs} ms between requests, budget ${numbers.budget}/${numbers.windowSeconds} s, deadline ${numbers.maxMinutes} min`);

  // ---- run ---------------------------------------------------------------------------------------------------------------
  const results = [];
  let stoppedBy = null;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const session = sessions.get(item.identity);
    const result = { id: item.id, identity: item.identity, method: item.method, path: item.template, access: item.access, expectation: item.expectation, assertion: item.assertion };

    if (stoppedBy) {
      results.push({ ...result, status: null, outcome: 'not-run', problem: stoppedBy });
      continue;
    }
    if (session?.lost) {
      results.push({ ...result, status: null, outcome: 'not-run', problem: session.lost });
      continue;
    }
    try {
      if (session) await session.ensureFresh();
      if (session?.lost) {
        results.push({ ...result, status: null, outcome: 'not-run', problem: session.lost });
        continue;
      }
      const send = () => client.request({ method: item.method, path: item.path, token: session?.accessToken, body: item.body });
      let answer = await send();
      if (session && answer.status === 401 && (await session.renewAfter401())) answer = await send();

      const verdict = evaluate(item, answer.status);
      result.status = answer.status;
      result.ms = answer.ms;
      if (verdict.ok) {
        result.outcome = 'pass';
      } else {
        result.outcome = 'fail';
        result.problem = verdict.problem;
        result.response = answer.status === 0 ? answer.error : describeBody(answer.text);
        result.requestId = answer.headers.get('x-request-id') ?? undefined;
      }
    } catch (e) {
      if (e instanceof DeadlineError) {
        stoppedBy = `not run: ${e.message}`;
        results.push({ ...result, status: null, outcome: 'not-run', problem: stoppedBy });
        continue;
      }
      throw e;
    }
    results.push(result);
    if (!values.quiet && ((index + 1) % 50 === 0 || index + 1 === items.length)) {
      const failed = results.filter((r) => r.outcome === 'fail').length;
      progress(`  [${index + 1}/${items.length}] ${failed} failing so far`);
    }
  }

  // ---- summarise -----------------------------------------------------------------------------------------------------------
  const tally = (list) => ({
    pass: list.filter((r) => r.outcome === 'pass').length,
    fail: list.filter((r) => r.outcome === 'fail').length,
    notRun: list.filter((r) => r.outcome === 'not-run').length,
  });
  const byAssertion = {};
  for (const key of ['A', 'B', 'C', 'E']) byAssertion[key] = tally(results.filter((r) => r.assertion === key));
  const ran = results.filter((r) => r.outcome !== 'not-run');
  const fiveXX = ran.filter((r) => r.status >= 500);
  byAssertion.D = { pass: ran.length - fiveXX.length, fail: fiveXX.length, notRun: results.length - ran.length };

  const failures = results.filter((r) => r.outcome === 'fail');
  const notRun = results.filter((r) => r.outcome === 'not-run');
  const finishedAt = new Date();
  const exitCode = failures.length > 0 || notRun.length > 0 ? 1 : 0;

  log('');
  log(`${pad('Assertion', 52)}${pad('PASS', 7)}${pad('FAIL', 7)}NOT RUN`);
  log('-'.repeat(75));
  for (const key of ['A', 'B', 'C', 'D', 'E']) {
    const row = byAssertion[key];
    const skippedAll = row.pass + row.fail + row.notRun === 0;
    log(`${pad(ASSERTION_TITLES[key], 52)}${pad(skippedAll ? '-' : row.pass, 7)}${pad(skippedAll ? '-' : row.fail, 7)}${skippedAll ? 'not planned (identity not given)' : row.notRun}`);
  }
  log('-'.repeat(75));
  log(`Total ${ran.length} requests sent (${client.stats.requests} on the wire incl. sign-in/refresh/retries), ${failures.length} failing, ${notRun.length} not run; ` +
    `${client.stats.rateLimited} answers were 429 and retried, waited ${Math.round(client.stats.waitedMs / 1000)} s for rate limits.`);

  if (failures.length) {
    log('\nFAILURES');
    for (const f of failures) {
      log(`  [${f.assertion}] ${f.identity} ${f.method} ${f.path}  (documented: ${f.access})`);
      log(`      ${f.problem}`);
      log(`      response: ${f.response}${f.requestId ? `  request-id ${f.requestId}` : ''}`);
    }
  }
  if (notRun.length) {
    log(`\n${notRun.length} requests were NOT RUN (first reason: ${notRun[0].problem}). The probe is incomplete: raise --max-minutes or wait for the rate-limit window.`);
  }
  log(`\n${exitCode === 0 ? 'PASS' : 'FAIL'}: ${failures.length} failing assertions across ${items.length} planned requests`);

  // ---- report (no tokens, no passwords, no response data) ---------------------------------------------------------------
  if (values.out) {
    const report = {
      tool: 'rbac-live',
      api: base,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationSeconds: Math.round((finishedAt - startedAt) / 1000),
      unsafe: values.unsafe,
      nonexistentId: NONEXISTENT_UUID,
      referenceEndpoints: endpoints.length,
      referenceByLevel: countByLevel(endpoints),
      identities: identityRows,
      summary: { planned: items.length, sent: ran.length, failed: failures.length, notRun: notRun.length, byAssertion, exitCode },
      rateLimit: { ...client.stats, waitedSeconds: Math.round(client.stats.waitedMs / 1000) },
      failures,
      results,
      notSent: { total: skipped.length, byReason: summariseSkipped(skipped), calls: skipped },
    };
    await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
    await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
    log(`Report written to ${values.out}`);
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e?.stack ?? e);
      process.exitCode = 2;
    }
  );
}
