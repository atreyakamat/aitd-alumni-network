import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseNpmAudit, evaluateAudit, validateAllowlist, matchingEntries, ghsaFromUrl, MAX_ENTRY_DAYS } from '../lib/audit.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const scanScript = path.join(here, '..', 'static-scan.mjs');
const baselineFile = path.join(here, 'fixtures', 'npm-audit-baseline-2026-11-11.json');
const realAllowlistFile = path.join(here, '..', 'audit-allowlist.json');
const TODAY = new Date('2026-11-11T12:00:00Z');

const advisory = (name, severity, title, ghsa) => ({ name, severity, title, url: `https://github.com/advisories/${ghsa}`, range: '<9' });
const auditJson = (...vias) => ({
  auditReportVersion: 2,
  vulnerabilities: Object.fromEntries(vias.map((via) => [via.name, { name: via.name, severity: via.severity, via: [via] }])),
  metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0, total: vias.length } },
});
const entry = (overrides = {}) => ({
  package: 'left-pad',
  severity: 'high',
  advisory: 'GHSA-aaaa-bbbb-cccc',
  reason: 'Not reachable: only the command line tool is affected and nothing runs it in this project.',
  expires: '2026-12-11',
  owner: 'platform-owner',
  ...overrides,
});
const FINDING = advisory('left-pad', 'high', 'left-pad pads wrongly', 'GHSA-aaaa-bbbb-cccc');

test('ghsaFromUrl extracts and normalises the id', () => {
  assert.equal(ghsaFromUrl('https://github.com/advisories/GHSA-MRHX-c7xc-m3w5'), 'GHSA-mrhx-c7xc-m3w5');
  assert.equal(ghsaFromUrl('https://example.com/x'), '');
  assert.equal(ghsaFromUrl(undefined), '');
});

test('parseNpmAudit makes one finding per advisory and ignores package-name hops', () => {
  const json = {
    vulnerabilities: {
      glob: { name: 'glob', severity: 'high', via: [advisory('glob', 'high', 'glob CLI injection', 'GHSA-5j98-mcp5-4vw2'), 'minimatch'] },
      'eslint-config-next': { name: 'eslint-config-next', severity: 'high', via: ['glob'] },
      minimatch: { name: 'minimatch', severity: 'high', via: [advisory('minimatch', 'high', 'ReDoS', 'GHSA-3ppc-4f35-3m26')] },
    },
    metadata: { vulnerabilities: { high: 3, total: 3 } },
  };
  const parsed = parseNpmAudit(json);
  assert.deepEqual(parsed.findings.map((f) => `${f.package}:${f.ghsa}`), ['glob:GHSA-5j98-mcp5-4vw2', 'minimatch:GHSA-3ppc-4f35-3m26']);
  assert.deepEqual(parsed.counts, { high: 3, total: 3 });
});

test('parseNpmAudit reports a failed or malformed audit as an error (never as a clean result)', () => {
  assert.match(parseNpmAudit({ error: { code: 'ENOTFOUND', summary: 'request failed' } }).error, /ENOTFOUND/);
  assert.match(parseNpmAudit(null).error, /no JSON/);
  assert.match(parseNpmAudit({ foo: 1 }).error, /unexpected report format/);
});

test('a finding that is not in the allowlist fails', () => {
  const result = evaluateAudit(parseNpmAudit(auditJson(FINDING)), { entries: [] }, { now: TODAY });
  assert.equal(result.status, 'FAIL');
  assert.equal(result.failures[0].state, 'unlisted');
});

test('a finding with a valid allowlist entry passes (by GHSA id or by exact title)', () => {
  for (const advisoryField of ['GHSA-aaaa-bbbb-cccc', 'ghsa-AAAA-bbbb-cccc', 'left-pad pads wrongly']) {
    const result = evaluateAudit(parseNpmAudit(auditJson(FINDING)), { entries: [entry({ advisory: advisoryField })] }, { now: TODAY });
    assert.equal(result.status, 'PASS', advisoryField);
    assert.equal(result.results[0].state, 'allowlisted');
  }
});

test('an expired entry no longer protects the finding (the last valid day still does)', () => {
  const parsed = parseNpmAudit(auditJson(FINDING));
  const lastDay = evaluateAudit(parsed, { entries: [entry({ expires: '2026-11-11' })] }, { now: TODAY });
  assert.equal(lastDay.status, 'PASS');
  const expired = evaluateAudit(parsed, { entries: [entry({ expires: '2026-11-10' })] }, { now: TODAY });
  assert.equal(expired.status, 'FAIL');
  assert.equal(expired.failures[0].state, 'expired');
});

test('an entry only matches its own package, advisory and severity', () => {
  const parsed = parseNpmAudit(auditJson(FINDING));
  for (const wrong of [{ package: 'other' }, { advisory: 'GHSA-zzzz-zzzz-zzzz' }, { severity: 'critical' }]) {
    const result = evaluateAudit(parsed, { entries: [entry(wrong)] }, { now: TODAY });
    assert.equal(result.status, 'FAIL', JSON.stringify(wrong));
  }
  assert.equal(matchingEntries(parsed.findings[0], [entry()]).length, 1);
});

test('only critical and high are gated: moderate and low findings pass without an entry', () => {
  const parsed = parseNpmAudit(auditJson(advisory('a', 'moderate', 'm', 'GHSA-1111-1111-1111'), advisory('b', 'low', 'l', 'GHSA-2222-2222-2222')));
  const result = evaluateAudit(parsed, { entries: [] }, { now: TODAY });
  assert.equal(result.status, 'PASS');
  assert.equal(result.results.length, 0);
  const critical = evaluateAudit(parseNpmAudit(auditJson(advisory('c', 'critical', 'c', 'GHSA-3333-3333-3333'))), { entries: [] }, { now: TODAY });
  assert.equal(critical.status, 'FAIL');
});

test('needs-fix entries pass but are reported; stale entries and entries about to expire are listed', () => {
  const parsed = parseNpmAudit(auditJson(FINDING));
  const result = evaluateAudit(
    parsed,
    { entries: [entry({ status: 'needs-fix', expires: '2026-11-15' }), entry({ package: 'gone', advisory: 'GHSA-9999-9999-9999' })] },
    { now: TODAY }
  );
  assert.equal(result.status, 'PASS');
  assert.equal(result.needsFix.length, 1);
  assert.equal(result.expiringSoon.length, 1);
  assert.deepEqual(result.staleEntries.map((e) => e.package), ['gone']);
});

test('validateAllowlist rejects incomplete, vague, over-long or misdated entries', () => {
  assert.deepEqual(validateAllowlist({ entries: [entry()] }, TODAY), []);
  assert.match(validateAllowlist({}, TODAY)[0], /entries/);
  const problems = (e) => validateAllowlist({ entries: [e] }, TODAY).join('\n');
  assert.match(problems(entry({ owner: '' })), /"owner" is required/);
  assert.match(problems(entry({ reason: 'fine' })), /at least 40 characters/);
  assert.match(problems(entry({ expires: '2026-02-30' })), /real date/);
  assert.match(problems(entry({ expires: '11/12/2026' })), /real date/);
  assert.match(problems(entry({ expires: '2027-06-01' })), new RegExp(`more than ${MAX_ENTRY_DAYS} days`));
  assert.match(problems(entry({ severity: 'severe' })), /severity must be/);
  assert.match(problems(entry({ status: 'whatever' })), /status must be/);
});

// ---- the repository's own allowlist against the baseline it was written for -------------------------------------------

const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
const realAllowlist = JSON.parse(await readFile(realAllowlistFile, 'utf8'));

test('the seeded allowlist is valid and short-lived', () => {
  assert.deepEqual(validateAllowlist(realAllowlist, TODAY), []);
  for (const e of realAllowlist.entries) {
    assert.ok(e.expires <= '2027-01-10', `${e.package} ${e.advisory} expires ${e.expires}`);
    assert.ok(['needs-fix', 'mitigated', 'not-applicable', 'accepted-risk'].includes(e.status), `${e.advisory} needs a status`);
  }
});

test('the seeded allowlist covers exactly the critical/high advisories of the 2026-11-11 baseline', () => {
  const parsed = parseNpmAudit(baseline);
  const result = evaluateAudit(parsed, realAllowlist, { now: TODAY });
  assert.equal(result.status, 'PASS', result.failures.map((f) => `${f.package} ${f.ghsa}`).join(', '));
  assert.equal(result.gatedCounts.critical, 3);
  assert.equal(result.gatedCounts.high, 16);
  assert.deepEqual(result.staleEntries, [], 'every entry still matches a finding');
  // the reachable findings of the baseline were fixed or mitigated on 2026-11-11 (Next 15.5.29, bounded request lists): none is left
  assert.deepEqual(result.needsFix, []);
});

test('the seeded allowlist stops protecting once its entries expire', () => {
  const parsed = parseNpmAudit(baseline);
  assert.equal(evaluateAudit(parsed, realAllowlist, { now: new Date('2026-12-12T12:00:00Z') }).status, 'FAIL', 'after the needs-fix entries expire');
  assert.equal(evaluateAudit(parsed, realAllowlist, { now: new Date('2027-01-11T12:00:00Z') }).failures.length, 19, 'after all entries expire');
});

test('removing one entry (or one new advisory appearing) fails the scan', () => {
  const parsed = parseNpmAudit(baseline);
  const without = { entries: realAllowlist.entries.filter((e) => e.advisory !== 'GHSA-mrhx-c7xc-m3w5') };
  const result = evaluateAudit(parsed, without, { now: TODAY });
  assert.equal(result.status, 'FAIL');
  assert.deepEqual(result.failures.map((f) => f.ghsa), ['GHSA-mrhx-c7xc-m3w5']);

  const withNew = structuredClone(baseline);
  withNew.vulnerabilities.next.via.push({ name: 'next', severity: 'high', title: 'Brand new advisory', url: 'https://github.com/advisories/GHSA-new0-new0-new0', range: '<99' });
  assert.deepEqual(evaluateAudit(parseNpmAudit(withNew), realAllowlist, { now: TODAY }).failures.map((f) => f.ghsa), ['GHSA-new0-new0-new0']);
});

// ---- the CLI gate, end to end on the saved report (no npm, no network) --------------------------------------------------

const scan = async (args) => {
  const out = await mkdtemp(path.join(tmpdir(), 'static-scan-'));
  try {
    const result = await run(process.execPath, [scanScript, '--only', 'audit', '--audit-file', baselineFile, '--out', out, ...args]).then(
      (r) => ({ code: 0, ...r }),
      (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr })
    );
    const report = JSON.parse(await readFile(path.join(out, 'static-scan.json'), 'utf8').catch(() => 'null'));
    return { ...result, report };
  } finally {
    await rm(out, { recursive: true, force: true });
  }
};

test('static-scan CLI: passes on the baseline today, fails after expiry, and --strict passes while no needs-fix entry exists', async () => {
  const ok = await scan(['--today', '2026-11-11']);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(ok.report.status, 'PASS');

  const expired = await scan(['--today', '2027-03-01']);
  assert.equal(expired.code, 1);
  assert.equal(expired.report.sections[0].status, 'FAIL');

  const strict = await scan(['--today', '2026-11-11', '--strict']);
  assert.equal(strict.code, 0, strict.stdout + strict.stderr);
});

test('static-scan CLI: an unknown scanner is a usage error; a broken allowlist is an ERROR', async () => {
  await assert.rejects(run(process.execPath, [scanScript, '--only', 'nope']), (e) => e.code === 2);
  const dir = await mkdtemp(path.join(tmpdir(), 'allowlist-'));
  try {
    const bad = path.join(dir, 'bad.json');
    await writeFile(bad, JSON.stringify({ entries: [{ package: 'x' }] }));
    const result = await scan(['--today', '2026-11-11', '--allowlist', bad]);
    assert.equal(result.code, 1);
    assert.equal(result.report.sections[0].status, 'ERROR');
    assert.match(result.stderr, /allowlist:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
