#!/usr/bin/env node
// Static and supply-chain scan (round 3, phase B of docs/SECURITY_AUDIT_PLAN.md).
//
//   node scripts/security/static-scan.mjs [--out security-report] [--docker-tools] [--only audit,gitleaks,hadolint,trivy]
//
//   audit      npm audit --omit=dev --json, gated by scripts/security/audit-allowlist.json (critical/high only)
//   gitleaks   gitleaks detect --redact over the whole git history
//   hadolint   hadolint server/Dockerfile client/Dockerfile
//   trivy      trivy fs --scanners vuln,secret,misconfig .
//
// A scanner that is not installed is recorded as SKIPPED (never as a failure). With --docker-tools the three external
// scanners run from pinned Docker images when the binary is missing (never use that flag on a machine where Docker must not run).
//
// Other flags: --allowlist <file>  --audit-file <npm-audit.json> (use a saved report instead of running npm)
//              --strict (an allowlist entry with status "needs-fix" also fails)  --today YYYY-MM-DD (tests)
//
// Writes <out>/static-scan.json, <out>/static-scan.md and each tool's raw report. Exit 1 only for real failures:
// a non-allowlisted (or expired) critical/high production advisory, a leaked secret, a hadolint error, an invalid allowlist,
// or a gate that could not run (npm audit failing is an ERROR, because "could not check" must not read as "clean").
// Zero dependencies, Node 20+.

import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseNpmAudit, evaluateAudit, validateAllowlist } from './lib/audit.mjs';
import { IMAGES, haveBinary, haveDocker, runCommand, dockerUserArgs, parseGitleaks, parseHadolint, parseTrivy } from './lib/scanners.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_ALLOWLIST = path.join(REPO, 'scripts', 'security', 'audit-allowlist.json');
const SECTIONS = ['audit', 'gitleaks', 'hadolint', 'trivy'];

const OPTIONS = {
  out: { type: 'string', default: 'security-report' },
  'docker-tools': { type: 'boolean', default: false },
  only: { type: 'string' },
  allowlist: { type: 'string' },
  'audit-file': { type: 'string' },
  strict: { type: 'boolean', default: false },
  today: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
};

const USAGE = 'Usage: node scripts/security/static-scan.mjs [--out security-report] [--docker-tools] [--only audit,gitleaks,hadolint,trivy] [--allowlist file] [--audit-file file] [--strict]';

const tail = (text, n = 6) => text.trim().split(/\r?\n/).slice(-n).join('\n');

/** Pick how to run an external tool: its binary, a pinned image (--docker-tools), or neither (SKIPPED). */
function resolveTool(name, binary, { dockerTools }) {
  if (haveBinary(binary, name === 'gitleaks' ? ['version'] : ['--version'])) return { mode: 'binary' };
  if (dockerTools) {
    if (haveDocker()) return { mode: 'docker', image: IMAGES[name] };
    return { mode: null, reason: `${binary} is not installed and Docker is not available for --docker-tools` };
  }
  return { mode: null, reason: `${binary} is not installed (install it, or pass --docker-tools on a host where Docker is allowed)` };
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---- audit ---------------------------------------------------------------------------------------------------------
async function scanAudit({ values, outDir, now }) {
  let raw;
  if (values['audit-file']) {
    raw = await readFile(values['audit-file'], 'utf8');
  } else {
    // npm exits 1 when it finds vulnerabilities; the JSON on stdout is what matters. (npm is npm.cmd on Windows.)
    const result = process.platform === 'win32'
      ? runCommand('npm audit --omit=dev --json', [], { cwd: REPO, shell: true })
      : runCommand('npm', ['audit', '--omit=dev', '--json'], { cwd: REPO });
    raw = result.stdout;
    if (result.error) return { name: 'audit', status: 'ERROR', mode: 'npm', summary: `could not start npm: ${result.error}` };
  }
  let json = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* parseNpmAudit reports it */
  }
  await writeFile(path.join(outDir, 'npm-audit.json'), raw);

  const parsed = parseNpmAudit(json);
  if (parsed.error) return { name: 'audit', status: 'ERROR', mode: values['audit-file'] ? 'file' : 'npm', summary: parsed.error };

  const allowlistFile = values.allowlist ?? DEFAULT_ALLOWLIST;
  let allowlist;
  try {
    allowlist = JSON.parse(await readFile(allowlistFile, 'utf8'));
  } catch (e) {
    return { name: 'audit', status: 'ERROR', mode: 'npm', summary: `cannot read allowlist ${allowlistFile}: ${e.message}` };
  }
  const problems = validateAllowlist(allowlist, now);
  if (problems.length) {
    return { name: 'audit', status: 'ERROR', mode: 'npm', summary: `the allowlist is invalid (${problems.length} problems)`, problems };
  }

  const evaluation = evaluateAudit(parsed, allowlist, { now });
  const strictFails = values.strict ? evaluation.needsFix : [];
  const status = evaluation.failures.length || strictFails.length ? 'FAIL' : 'PASS';
  const c = evaluation.npmCounts;
  return {
    name: 'audit',
    status,
    mode: values['audit-file'] ? 'file' : 'npm',
    summary:
      `${evaluation.gatedCounts.critical ?? 0} critical + ${evaluation.gatedCounts.high ?? 0} high advisories; ` +
      `${evaluation.failures.length} not covered by the allowlist; ${evaluation.needsFix.length} allowlisted but marked needs-fix` +
      (c && c.total !== undefined ? ` (npm package counts: ${c.critical} critical, ${c.high} high, ${c.moderate} moderate, ${c.low} low)` : ''),
    evaluation,
  };
}

// ---- gitleaks --------------------------------------------------------------------------------------------------------
async function scanGitleaks({ options, outDir }) {
  const tool = resolveTool('gitleaks', 'gitleaks', options);
  if (!tool.mode) return { name: 'gitleaks', status: 'SKIPPED', mode: null, summary: tool.reason };
  const shallow = runCommand('git', ['rev-parse', '--is-shallow-repository'], { cwd: REPO });
  const warning = shallow.stdout.trim() === 'true' ? 'the checkout is shallow: only the fetched history was scanned (use fetch-depth: 0)' : undefined;
  const report = path.join(outDir, 'gitleaks.json');
  // exit code 2 = leaks found, 1 = the tool failed, 0 = clean
  const common = ['--redact', '--report-format', 'json', '--no-banner', '--exit-code', '2'];
  let result;
  if (tool.mode === 'binary') {
    result = runCommand('gitleaks', ['detect', '--source', REPO, ...common, '--report-path', report], { cwd: REPO });
  } else {
    result = runCommand('docker', [
      'run', '--rm', ...dockerUserArgs(),
      '-v', `${REPO}:/repo:ro`, '-v', `${outDir}:/out`,
      // git refuses a repository owned by another uid unless it is declared safe
      '-e', 'GIT_CONFIG_COUNT=1', '-e', 'GIT_CONFIG_KEY_0=safe.directory', '-e', 'GIT_CONFIG_VALUE_0=/repo',
      tool.image ?? IMAGES.gitleaks, 'detect', '--source', '/repo', ...common, '--report-path', '/out/gitleaks.json',
    ]);
  }
  if (result.error || (result.status !== 0 && result.status !== 2)) {
    return { name: 'gitleaks', status: 'ERROR', mode: tool.mode, summary: `gitleaks failed (exit ${result.status}): ${result.error ?? tail(result.stderr)}` };
  }
  const parsed = parseGitleaks(result.status === 2 ? await readJsonIfPresent(report) : []);
  return {
    name: 'gitleaks',
    status: result.status === 2 && !parsed.findings.length ? 'FAIL' : parsed.status,
    mode: tool.mode,
    summary: `${parsed.findings.length} leaked secret(s) in the scanned history${warning ? ` (${warning})` : ''}`,
    findings: parsed.findings,
  };
}

// ---- hadolint ----------------------------------------------------------------------------------------------------------
async function scanHadolint({ options, outDir }) {
  const tool = resolveTool('hadolint', 'hadolint', options);
  if (!tool.mode) return { name: 'hadolint', status: 'SKIPPED', mode: null, summary: tool.reason };
  const files = ['server/Dockerfile', 'client/Dockerfile'];
  const result = tool.mode === 'binary'
    ? runCommand('hadolint', ['--no-fail', '--format', 'json', ...files], { cwd: REPO })
    : runCommand('docker', ['run', '--rm', ...dockerUserArgs(), '-v', `${REPO}:/repo:ro`, '-w', '/repo', tool.image ?? IMAGES.hadolint, 'hadolint', '--no-fail', '--format', 'json', ...files]);
  if (result.error || result.status !== 0) {
    return { name: 'hadolint', status: 'ERROR', mode: tool.mode, summary: `hadolint failed (exit ${result.status}): ${result.error ?? tail(result.stderr)}` };
  }
  await writeFile(path.join(outDir, 'hadolint.json'), result.stdout || '[]');
  let json = [];
  try {
    json = JSON.parse(result.stdout || '[]');
  } catch {
    return { name: 'hadolint', status: 'ERROR', mode: tool.mode, summary: 'hadolint printed no JSON' };
  }
  const parsed = parseHadolint(json);
  return { name: 'hadolint', status: parsed.status, mode: tool.mode, summary: `${parsed.errors} error(s), ${parsed.warnings} warning(s), ${parsed.info} info`, items: parsed.items };
}

// ---- trivy ---------------------------------------------------------------------------------------------------------------
async function scanTrivy({ options, outDir, allowlist, now }) {
  const tool = resolveTool('trivy', 'trivy', options);
  if (!tool.mode) return { name: 'trivy', status: 'SKIPPED', mode: null, summary: tool.reason };
  const skip = ['**/node_modules', '**/.next', '**/dist', '**/coverage', '**/uploads', '.git'].flatMap((dir) => ['--skip-dirs', dir]);
  const common = ['fs', '--scanners', 'vuln,secret,misconfig', '--format', 'json', '--exit-code', '0', '--quiet', ...skip];
  const result = tool.mode === 'binary'
    ? runCommand('trivy', [...common, '--output', path.join(outDir, 'trivy.json'), '.'], { cwd: REPO })
    : runCommand('docker', [
        'run', '--rm', ...dockerUserArgs(), '-e', 'TRIVY_CACHE_DIR=/tmp/trivy-cache',
        '-v', `${REPO}:/repo:ro`, '-v', `${outDir}:/out`, '-w', '/repo',
        tool.image ?? IMAGES.trivy, ...common, '--output', '/out/trivy.json', '.',
      ]);
  if (result.error || result.status !== 0) {
    return { name: 'trivy', status: 'ERROR', mode: tool.mode, summary: `trivy failed (exit ${result.status}): ${result.error ?? tail(result.stderr)}` };
  }
  const json = await readJsonIfPresent(path.join(outDir, 'trivy.json'));
  if (!json) return { name: 'trivy', status: 'ERROR', mode: tool.mode, summary: 'trivy wrote no report' };
  const parsed = parseTrivy(json, allowlist, now);
  return {
    name: 'trivy',
    status: parsed.status,
    mode: tool.mode,
    summary: `${parsed.vulnerabilities.length} high/critical vulnerabilities (${parsed.failingVulnerabilities.length} not allowlisted), ${parsed.secrets.length} secret(s), ${parsed.misconfigurations.length} high/critical misconfiguration(s) (reported, not gated)`,
    vulnerabilities: parsed.failingVulnerabilities,
    secrets: parsed.secrets,
    misconfigurations: parsed.misconfigurations,
  };
}

// ---- report ------------------------------------------------------------------------------------------------------------------
function renderMarkdown(report) {
  const lines = [];
  lines.push('# Static scan', '', `Generated ${report.generatedAt}. Overall: **${report.status}**.`, '');
  lines.push('| Scanner | Status | Mode | Summary |', '|---|---|---|---|');
  for (const s of report.sections) lines.push(`| ${s.name} | ${s.status} | ${s.mode ?? '-'} | ${s.summary.replace(/\|/g, '/')} |`);
  lines.push('');

  const audit = report.sections.find((s) => s.name === 'audit');
  if (audit?.problems) {
    lines.push('## Allowlist problems', '', ...audit.problems.map((p) => `- ${p}`), '');
  }
  if (audit?.evaluation) {
    const e = audit.evaluation;
    lines.push('## npm audit (production dependencies, critical and high advisories)', '');
    if (e.failures.length) {
      lines.push('### Failing: not covered by a valid allowlist entry', '', '| Package | Severity | Advisory | State |', '|---|---|---|---|');
      for (const f of e.failures) lines.push(`| ${f.package} | ${f.severity} | ${f.ghsa || f.title} ${f.ghsa ? `(${f.title})` : ''} | ${f.state} |`);
      lines.push('');
    }
    if (e.needsFix.length) {
      lines.push('### Allowlisted but marked needs-fix (real findings; the allowlist only defers the failure)', '', '| Package | Severity | Advisory | Expires | Reason |', '|---|---|---|---|---|');
      for (const f of e.needsFix) lines.push(`| ${f.package} | ${f.severity} | ${f.ghsa} | ${f.entry.expires} | ${f.entry.reason.replace(/\|/g, '/')} |`);
      lines.push('');
    }
    const others = e.results.filter((r) => r.state === 'allowlisted' && r.entry.status !== 'needs-fix');
    if (others.length) {
      lines.push('### Allowlisted with a reason', '', '| Package | Severity | Advisory | Status | Expires |', '|---|---|---|---|---|');
      for (const f of others) lines.push(`| ${f.package} | ${f.severity} | ${f.ghsa} | ${f.entry.status ?? '-'} | ${f.entry.expires} |`);
      lines.push('');
    }
    if (e.expiringSoon.length) lines.push(`Entries expiring within 7 days: ${e.expiringSoon.map((f) => `${f.package} ${f.ghsa}`).join(', ')}`, '');
    if (e.staleEntries.length) lines.push(`Allowlist entries that match nothing today (remove them): ${e.staleEntries.map((x) => `${x.package} ${x.advisory}`).join(', ')}`, '');
  }
  for (const s of report.sections.filter((x) => x.name === 'gitleaks' && x.findings?.length)) {
    lines.push('## Leaked secrets (values redacted)', '', '| Rule | File | Line | Commit |', '|---|---|---|---|');
    for (const f of s.findings) lines.push(`| ${f.rule} | ${f.file} | ${f.line} | ${f.commit} |`);
    lines.push('');
  }
  for (const s of report.sections.filter((x) => x.name === 'hadolint' && x.items?.length)) {
    lines.push('## hadolint', '', '| Level | File | Line | Code | Message |', '|---|---|---|---|---|');
    for (const f of s.items) lines.push(`| ${f.level} | ${f.file} | ${f.line} | ${f.code} | ${String(f.message).replace(/\|/g, '/')} |`);
    lines.push('');
  }
  for (const s of report.sections.filter((x) => x.name === 'trivy' && x.status !== 'SKIPPED')) {
    if (s.vulnerabilities?.length) {
      lines.push('## trivy: high/critical vulnerabilities not allowlisted', '', '| Package | Version | Severity | Id | Fixed in |', '|---|---|---|---|---|');
      for (const v of s.vulnerabilities) lines.push(`| ${v.package} | ${v.version} | ${v.severity} | ${v.ghsa} | ${v.fixed || '-'} |`);
      lines.push('');
    }
    if (s.misconfigurations?.length) {
      lines.push('## trivy: high/critical misconfigurations (review items)', '', '| Id | Severity | File | Title |', '|---|---|---|---|');
      for (const m of s.misconfigurations) lines.push(`| ${m.id} | ${m.severity} | ${m.file} | ${m.title} |`);
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

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
  const only = values.only ? values.only.split(',').map((s) => s.trim()).filter(Boolean) : SECTIONS;
  const unknown = only.filter((s) => !SECTIONS.includes(s));
  if (unknown.length) {
    error(`unknown scanner(s): ${unknown.join(', ')} (choose from ${SECTIONS.join(', ')})`);
    return 2;
  }
  const now = values.today ? new Date(`${values.today}T12:00:00Z`) : new Date();
  if (Number.isNaN(now.getTime())) {
    error('--today must be YYYY-MM-DD');
    return 2;
  }

  const outDir = path.resolve(values.out);
  await mkdir(outDir, { recursive: true });
  const options = { dockerTools: values['docker-tools'] };

  const sections = [];
  let allowlistForTrivy = { entries: [] };
  try {
    allowlistForTrivy = JSON.parse(await readFile(values.allowlist ?? DEFAULT_ALLOWLIST, 'utf8'));
  } catch {
    /* the audit section reports an unreadable allowlist */
  }
  const runners = {
    audit: () => scanAudit({ values, outDir, now }),
    gitleaks: () => scanGitleaks({ options, outDir }),
    hadolint: () => scanHadolint({ options, outDir }),
    trivy: () => scanTrivy({ options, outDir, allowlist: allowlistForTrivy, now }),
  };
  for (const name of only) {
    log(`== ${name} ...`);
    let section;
    try {
      section = await runners[name]();
    } catch (e) {
      section = { name, status: 'ERROR', mode: null, summary: `unexpected error: ${e.message}` };
    }
    sections.push(section);
    log(`   ${section.status}${section.mode ? ` (${section.mode})` : ''}: ${section.summary}`);
  }

  const failed = sections.filter((s) => s.status === 'FAIL' || s.status === 'ERROR');
  const report = {
    tool: 'static-scan',
    generatedAt: new Date().toISOString(),
    status: failed.length ? 'FAIL' : 'PASS',
    dockerTools: options.dockerTools,
    sections,
  };
  await writeFile(path.join(outDir, 'static-scan.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outDir, 'static-scan.md'), renderMarkdown(report));

  const audit = sections.find((s) => s.name === 'audit');
  if (audit?.problems) for (const p of audit.problems) error(`allowlist: ${p}`);
  if (audit?.evaluation?.failures.length) {
    log('\nNot covered by the allowlist (these fail the scan):');
    for (const f of audit.evaluation.failures) log(`  ${f.severity.toUpperCase().padEnd(8)} ${f.package}  ${f.ghsa || ''}  ${f.title}  [${f.state}]`);
  }
  if (audit?.evaluation?.needsFix.length) {
    log('\nNeeds a fix (allowlisted for now, expiring):');
    for (const f of audit.evaluation.needsFix) log(`  ${f.severity.toUpperCase().padEnd(8)} ${f.package}  ${f.ghsa}  until ${f.entry.expires}  ${f.title}`);
  }
  log(`\nReports: ${path.join(outDir, 'static-scan.json')} and static-scan.md`);
  log(`\n${report.status}: ${sections.map((s) => `${s.name} ${s.status}`).join(', ')}`);
  return failed.length ? 1 : 0;
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
