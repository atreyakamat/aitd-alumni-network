// External scanners for static-scan.mjs: how to find them (binary on PATH, or a pinned Docker image with --docker-tools)
// and how to read their JSON. The parsers are pure and unit-tested with sample reports.
//
// Tool versions live here and ONLY here (the CI workflow pins its own copy; docs/SECURITY_AUDIT_PLAN.md lists both).
// If a pull fails offline, bump the one line.

import { spawnSync } from 'node:child_process';
import { matchingEntries, isoDate } from './audit.mjs';

export const IMAGES = {
  gitleaks: 'zricethezav/gitleaks:v8.21.2',
  hadolint: 'hadolint/hadolint:v2.12.0-alpine',
  trivy: 'aquasec/trivy:0.57.1',
};

/** True when `cmd` can be started (it answers --version). Never throws. */
export function haveBinary(cmd, args = ['--version']) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  return !result.error && result.status !== null;
}

export function haveDocker() {
  const result = spawnSync('docker', ['version', '--format', '{{.Client.Version}}'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
  return !result.error && result.status === 0;
}

/** Run a command and collect its output (no shell, no user input in the arguments). */
export function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, ...options });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error ? String(result.error.message) : null };
}

/** `--user uid:gid` so files written into a mounted report folder belong to the caller (not root). */
export function dockerUserArgs() {
  return typeof process.getuid === 'function' ? ['--user', `${process.getuid()}:${process.getgid()}`] : [];
}

// ---------------------------------------------------------------------------------------------------------------------
// gitleaks: `detect --redact` over the whole git history. The report keeps rule, file, line, commit and fingerprint only.
// ---------------------------------------------------------------------------------------------------------------------
export function parseGitleaks(json) {
  const list = Array.isArray(json) ? json : [];
  const findings = list.map((f) => ({
    rule: f.RuleID ?? f.ruleID ?? '',
    description: f.Description ?? f.description ?? '',
    file: f.File ?? f.file ?? '',
    line: f.StartLine ?? f.startLine ?? null,
    commit: String(f.Commit ?? f.commit ?? '').slice(0, 10),
    fingerprint: f.Fingerprint ?? f.fingerprint ?? '',
  }));
  return { status: findings.length ? 'FAIL' : 'PASS', findings };
}

// ---------------------------------------------------------------------------------------------------------------------
// hadolint: `--format json`, an array of { file, line, column, level, code, message }. Only level "error" fails.
// ---------------------------------------------------------------------------------------------------------------------
export function parseHadolint(json) {
  const list = Array.isArray(json) ? json : [];
  const items = list.map((f) => ({ file: f.file, line: f.line, level: f.level, code: f.code, message: f.message }));
  const count = (level) => items.filter((i) => i.level === level).length;
  return {
    status: count('error') ? 'FAIL' : 'PASS',
    errors: count('error'),
    warnings: count('warning'),
    info: count('info') + count('style'),
    items,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// trivy fs: vulnerabilities (HIGH/CRITICAL gated with the same allowlist as npm audit), secrets (any secret fails),
// misconfigurations (reported, not gated: the image scan in CI and the audit plan treat them as review items).
// ---------------------------------------------------------------------------------------------------------------------
export function parseTrivy(json, allowlist, now = new Date()) {
  const today = isoDate(now);
  const entries = allowlist?.entries ?? [];
  const vulns = [];
  const secrets = [];
  const misconfigs = [];

  for (const result of json?.Results ?? []) {
    for (const v of result.Vulnerabilities ?? []) {
      const severity = String(v.Severity ?? '').toLowerCase();
      if (severity !== 'critical' && severity !== 'high') continue;
      const finding = { package: v.PkgName, severity, title: v.Title ?? '', ghsa: v.VulnerabilityID ?? '', version: v.InstalledVersion, fixed: v.FixedVersion ?? '', target: result.Target };
      const matches = matchingEntries(finding, entries);
      const valid = matches.find((e) => e.expires >= today);
      vulns.push({ ...finding, state: valid ? 'allowlisted' : matches.length ? 'expired' : 'unlisted' });
    }
    for (const s of result.Secrets ?? []) {
      secrets.push({ rule: s.RuleID, title: s.Title, severity: s.Severity, file: result.Target, line: s.StartLine });
    }
    for (const m of result.Misconfigurations ?? []) {
      const severity = String(m.Severity ?? '').toLowerCase();
      if (m.Status === 'FAIL' && (severity === 'critical' || severity === 'high')) {
        misconfigs.push({ id: m.ID, title: m.Title, severity, file: result.Target });
      }
    }
  }
  const failingVulns = vulns.filter((v) => v.state !== 'allowlisted');
  return {
    status: failingVulns.length || secrets.length ? 'FAIL' : 'PASS',
    vulnerabilities: vulns,
    failingVulnerabilities: failingVulns,
    secrets,
    misconfigurations: misconfigs,
  };
}
