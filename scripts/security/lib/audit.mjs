// `npm audit --omit=dev --json` parsing and the allowlist gate used by static-scan.mjs and the CI `dependencies` job.
//
// Gate: any critical or high production-dependency ADVISORY that is not covered by a valid allowlist entry fails.
// An advisory is one object in a package's `via` list of the audit report (a transitive package whose `via` is only other
// package names is not a finding of its own: it is "high" only because of an advisory deeper down, which is gated itself).
//
// Allowlist file (scripts/security/audit-allowlist.json):
//   { "entries": [ { "package": "next", "severity": "high", "advisory": "GHSA-xxxx-xxxx-xxxx" | "<advisory title>",
//                    "reason": "...", "expires": "YYYY-MM-DD", "owner": "...", "status": "needs-fix|mitigated|not-applicable|accepted-risk" } ] }
// An entry matches a finding when package, severity and advisory (GHSA id or exact title, case-insensitive) all agree.
// An expired entry no longer protects anything. Entries must not run longer than MAX_ENTRY_DAYS from today, so that the
// reasoning is looked at again.

export const GATED_SEVERITIES = ['critical', 'high'];
export const MAX_ENTRY_DAYS = 90;
export const ENTRY_STATUSES = ['needs-fix', 'mitigated', 'not-applicable', 'accepted-risk'];
const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];
const DAY_MS = 86_400_000;

/** "https://github.com/advisories/GHSA-abcd-1234-efgh" -> "GHSA-abcd-1234-efgh" ('' when none) */
export function ghsaFromUrl(url) {
  const match = /GHSA(?:-[a-z0-9]{4}){3}/i.exec(String(url ?? ''));
  return match ? `GHSA${match[0].slice(4).toLowerCase()}` : '';
}

/**
 * Turn the JSON of `npm audit --json` (auditReportVersion 2) into advisory-level findings.
 * @returns {{ findings: Array<{package: string, severity: string, title: string, ghsa: string, url: string, range: string}>,
 *            counts: object, error?: string }}
 */
export function parseNpmAudit(json) {
  if (!json || typeof json !== 'object') return { findings: [], counts: {}, error: 'npm audit produced no JSON' };
  if (json.error) {
    return { findings: [], counts: {}, error: `npm audit failed: ${json.error.code ?? ''} ${json.error.summary ?? json.error.detail ?? ''}`.trim() };
  }
  if (!json.vulnerabilities) return { findings: [], counts: {}, error: 'npm audit JSON has no "vulnerabilities" key (unexpected report format)' };

  const found = new Map();
  for (const node of Object.values(json.vulnerabilities)) {
    for (const via of node.via ?? []) {
      if (typeof via !== 'object' || via === null) continue; // a package name: not an advisory
      const ghsa = ghsaFromUrl(via.url);
      const key = `${via.name}|${ghsa || via.title}`;
      if (found.has(key)) continue;
      found.set(key, {
        package: via.name,
        severity: String(via.severity ?? 'info').toLowerCase(),
        title: via.title ?? '',
        ghsa,
        url: via.url ?? '',
        range: via.range ?? '',
      });
    }
  }
  const findings = [...found.values()].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.package.localeCompare(b.package) || a.title.localeCompare(b.title)
  );
  return { findings, counts: json.metadata?.vulnerabilities ?? {} };
}

/** UTC calendar date of a Date as YYYY-MM-DD */
export const isoDate = (date) => date.toISOString().slice(0, 10);

const isValidDay = (text) => /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T00:00:00Z`)) && isoDate(new Date(`${text}T00:00:00Z`)) === text;

/** Check the allowlist file's shape. Returns a list of problems (empty = valid). */
export function validateAllowlist(data, now = new Date()) {
  const problems = [];
  if (!data || !Array.isArray(data.entries)) return ['allowlist must be an object with an "entries" array'];
  const horizon = isoDate(new Date(now.getTime() + MAX_ENTRY_DAYS * DAY_MS));
  data.entries.forEach((entry, i) => {
    const label = `entries[${i}] (${entry?.package ?? '?'} / ${entry?.advisory ?? '?'})`;
    for (const field of ['package', 'severity', 'advisory', 'reason', 'expires', 'owner']) {
      if (typeof entry?.[field] !== 'string' || !entry[field].trim()) problems.push(`${label}: "${field}" is required`);
    }
    if (typeof entry?.severity === 'string' && !SEVERITIES.includes(entry.severity)) problems.push(`${label}: severity must be one of ${SEVERITIES.join(', ')}`);
    if (typeof entry?.reason === 'string' && entry.reason.trim().length < 40) problems.push(`${label}: "reason" must explain the decision (at least 40 characters)`);
    if (typeof entry?.expires === 'string') {
      if (!isValidDay(entry.expires)) problems.push(`${label}: "expires" must be a real date YYYY-MM-DD`);
      else if (entry.expires > horizon) problems.push(`${label}: expires ${entry.expires} is more than ${MAX_ENTRY_DAYS} days away (latest ${horizon}); allowlist entries are short-lived on purpose`);
    }
    if (entry?.status !== undefined && !ENTRY_STATUSES.includes(entry.status)) problems.push(`${label}: status must be one of ${ENTRY_STATUSES.join(', ')}`);
  });
  return problems;
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/** The allowlist entries that name this finding (whether or not they have expired). */
export function matchingEntries(finding, entries) {
  return entries.filter(
    (entry) =>
      same(entry.package, finding.package) &&
      same(entry.severity, finding.severity) &&
      (same(entry.advisory, finding.ghsa) || same(entry.advisory, finding.title))
  );
}

/**
 * Apply the gate.
 * @param {ReturnType<typeof parseNpmAudit>} parsed
 * @param {{ entries: object[] }} allowlist
 * @param {{ now?: Date, gated?: string[] }} [options]
 */
export function evaluateAudit(parsed, allowlist, { now = new Date(), gated = GATED_SEVERITIES } = {}) {
  const today = isoDate(now);
  const entries = allowlist?.entries ?? [];
  const used = new Set();
  const results = [];

  for (const finding of parsed.findings) {
    if (!gated.includes(finding.severity)) continue;
    const matches = matchingEntries(finding, entries);
    matches.forEach((entry) => used.add(entry));
    const valid = matches.find((entry) => entry.expires >= today);
    let state;
    if (valid) state = 'allowlisted';
    else if (matches.length) state = 'expired';
    else state = 'unlisted';
    results.push({ ...finding, state, entry: valid ?? matches[0] ?? null });
  }

  const failures = results.filter((r) => r.state !== 'allowlisted');
  const needsFix = results.filter((r) => r.state === 'allowlisted' && r.entry?.status === 'needs-fix');
  const expiringSoon = results.filter((r) => r.state === 'allowlisted' && r.entry.expires <= isoDate(new Date(now.getTime() + 7 * DAY_MS)));
  const staleEntries = entries.filter((entry) => !used.has(entry));
  const gatedCounts = Object.fromEntries(gated.map((s) => [s, results.filter((r) => r.severity === s).length]));

  return {
    status: failures.length ? 'FAIL' : 'PASS',
    gated,
    gatedCounts,
    npmCounts: parsed.counts,
    results,
    failures,
    needsFix,
    expiringSoon,
    staleEntries,
  };
}
