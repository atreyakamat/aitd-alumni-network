import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseGitleaks, parseHadolint, parseTrivy, IMAGES, haveBinary } from '../lib/scanners.mjs';
import { isLikelyTestHost } from '../lib/target-guard.mjs';
import { jwtExpiryMs, describeBody } from '../lib/session.mjs';

test('pinned scanner images carry an explicit version, never latest', () => {
  for (const [tool, image] of Object.entries(IMAGES)) {
    assert.match(image, /:[v]?\d+\.\d+\.\d+/, `${tool} ${image}`);
    assert.doesNotMatch(image, /latest/);
  }
});

test('a missing binary is reported as unavailable, not as an error', () => {
  assert.equal(haveBinary('definitely-not-a-real-binary-xyz'), false);
});

test('gitleaks: no findings passes; any finding fails and the report keeps no secret value', () => {
  assert.equal(parseGitleaks([]).status, 'PASS');
  assert.equal(parseGitleaks(null).status, 'PASS');
  const parsed = parseGitleaks([
    { RuleID: 'generic-api-key', Description: 'key', File: 'DEPLOYMENT.md', StartLine: 12, Commit: 'abcdef0123456789', Fingerprint: 'abcdef:DEPLOYMENT.md:generic-api-key:12', Secret: 'REDACTED', Match: 'x=REDACTED' },
  ]);
  assert.equal(parsed.status, 'FAIL');
  assert.deepEqual(Object.keys(parsed.findings[0]).sort(), ['commit', 'description', 'file', 'fingerprint', 'line', 'rule']);
  assert.equal(parsed.findings[0].commit, 'abcdef0123');
  assert.ok(!JSON.stringify(parsed).includes('REDACTED'));
});

test('hadolint: only errors fail', () => {
  const info = { file: 'server/Dockerfile', line: 3, column: 1, level: 'info', code: 'DL3059', message: 'Multiple consecutive RUN' };
  const warning = { ...info, level: 'warning', code: 'DL3018' };
  const error = { ...info, level: 'error', code: 'DL1001' };
  assert.equal(parseHadolint([info, warning]).status, 'PASS');
  const failing = parseHadolint([info, warning, error]);
  assert.equal(failing.status, 'FAIL');
  assert.deepEqual([failing.errors, failing.warnings, failing.info], [1, 1, 1]);
  assert.equal(parseHadolint([]).status, 'PASS');
});

test('trivy: secrets always fail; high/critical vulnerabilities fail unless allowlisted; misconfigurations are reported only', () => {
  const report = {
    Results: [
      {
        Target: 'package-lock.json',
        Vulnerabilities: [
          { VulnerabilityID: 'GHSA-mrhx-c7xc-m3w5', PkgName: 'zod', InstalledVersion: '3.25.76', FixedVersion: '4.6.6', Severity: 'HIGH', Title: 'Zod can exhaust memory' },
          { VulnerabilityID: 'CVE-2099-0001', PkgName: 'left-pad', InstalledVersion: '1.0.0', Severity: 'CRITICAL', Title: 'x' },
          { VulnerabilityID: 'CVE-2099-0002', PkgName: 'tiny', InstalledVersion: '1.0.0', Severity: 'LOW', Title: 'ignored: low' },
        ],
      },
      { Target: 'server/Dockerfile', Misconfigurations: [{ ID: 'DS002', Title: 'root user', Severity: 'HIGH', Status: 'FAIL' }, { ID: 'DS026', Title: 'no healthcheck', Severity: 'LOW', Status: 'FAIL' }] },
    ],
  };
  const allowlist = { entries: [{ package: 'zod', severity: 'high', advisory: 'GHSA-mrhx-c7xc-m3w5', reason: 'x'.repeat(50), expires: '2026-12-11', owner: 'o' }] };
  const now = new Date('2026-11-11T12:00:00Z');

  const parsed = parseTrivy(report, allowlist, now);
  assert.equal(parsed.status, 'FAIL');
  assert.deepEqual(parsed.failingVulnerabilities.map((v) => v.package), ['left-pad']);
  assert.equal(parsed.vulnerabilities.find((v) => v.package === 'zod').state, 'allowlisted');
  assert.deepEqual(parsed.misconfigurations.map((m) => m.id), ['DS002']);

  const clean = parseTrivy({ Results: report.Results.slice(1) }, allowlist, now);
  assert.equal(clean.status, 'PASS', 'misconfigurations alone do not fail');

  const leaked = parseTrivy({ Results: [{ Target: '.env', Secrets: [{ RuleID: 'aws-access-key-id', Title: 'AWS key', Severity: 'CRITICAL', StartLine: 1 }] }] }, allowlist, now);
  assert.equal(leaked.status, 'FAIL');
  assert.equal(leaked.secrets.length, 1);

  const expired = parseTrivy(report, allowlist, new Date('2027-01-01T12:00:00Z'));
  assert.equal(expired.vulnerabilities.find((v) => v.package === 'zod').state, 'expired');
});

test('target guard: test stacks pass, public-looking hosts need --allow-remote', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]', '::1', '10.1.2.3', '192.168.1.20', '172.16.0.5', '172.31.255.1', '100.64.0.1', '100.101.102.103', 'atreya-2', 'api', 'box.local', 'atreya-2.tail1234.ts.net', 'svc.internal', 'a.test', 'fd12:3456::1']) {
    assert.equal(isLikelyTestHost(host), true, host);
  }
  for (const host of ['www.example.edu', 'alumni.example.com', '8.8.8.8', '172.32.0.1', '100.128.0.1', '100.63.0.1', '203.0.113.7', 'aiemconnect.example.org', '']) {
    assert.equal(isLikelyTestHost(host), false, host);
  }
});

test('jwtExpiryMs reads exp without trusting the token; non-JWTs give null', () => {
  const payload = Buffer.from(JSON.stringify({ exp: 1_800_000_000 })).toString('base64url');
  assert.equal(jwtExpiryMs(`aaa.${payload}.sig`), 1_800_000_000_000);
  assert.equal(jwtExpiryMs('opaque-token'), null);
  assert.equal(jwtExpiryMs('a.b.c'), null);
  assert.equal(jwtExpiryMs(undefined), null);
});

test('describeBody never echoes response data', () => {
  assert.equal(describeBody(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } })), 'FORBIDDEN: Insufficient permissions');
  const leaky = describeBody(JSON.stringify({ success: true, data: [{ email: 'someone@example.com' }] }));
  assert.match(leaky, /^JSON \d+ bytes, keys: success,data$/);
  assert.ok(!leaky.includes('someone@example.com'));
  assert.equal(describeBody(''), 'empty body');
  assert.match(describeBody('<html>secret</html>'), /^non-JSON \d+ bytes$/);
});
