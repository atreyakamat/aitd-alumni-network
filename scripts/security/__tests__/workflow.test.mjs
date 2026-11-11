import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const workflowFile = path.join(root, '.github', 'workflows', 'security.yml');
const doc = yaml.load(await readFile(workflowFile, 'utf8'));
const jobs = doc.jobs;

/** The only actions this workflow may use, with the exact tag each must be pinned to. */
const ALLOWED = {
  'actions/checkout': 'v4',
  'actions/setup-node': 'v4',
  'actions/upload-artifact': 'v4',
  'docker/setup-buildx-action': 'v3',
  'hadolint/hadolint-action': 'v3.1.0',
  'gitleaks/gitleaks-action': 'v2',
  'aquasecurity/trivy-action': '0.28.0',
  'github/codeql-action/init': 'v3',
  'github/codeql-action/analyze': 'v3',
};

const steps = (job) => job.steps ?? [];
const allSteps = Object.entries(jobs).flatMap(([name, job]) => steps(job).map((step) => ({ job: name, ...step })));
const triggers = doc.on ?? doc[true];

test('the workflow parses and has the six jobs', () => {
  assert.equal(doc.name, 'Security');
  assert.deepEqual(Object.keys(jobs).sort(), ['codeql', 'dependencies', 'dockerfiles', 'dynamic', 'images', 'secrets']);
});

test('triggers: pull_request and push to main, a weekly schedule, workflow_dispatch', () => {
  assert.deepEqual(triggers.pull_request.branches, ['main']);
  assert.deepEqual(triggers.push.branches, ['main']);
  assert.equal(triggers.schedule.length, 1);
  assert.match(triggers.schedule[0].cron, /^\d+ \d+ \* \* [0-6]$/, 'a weekly cron (one weekday)');
  assert.ok('workflow_dispatch' in triggers);
});

test('every action is pinned to a version tag, never latest/main/master/empty', () => {
  const uses = allSteps.filter((s) => s.uses);
  assert.ok(uses.length >= 15);
  for (const step of uses) {
    const match = /^([^@\s]+)@(.*)$/.exec(step.uses);
    assert.ok(match, `${step.job}: "${step.uses}" has no @version`);
    const [, name, ref] = match;
    assert.ok(ref, `${step.uses} has an empty ref`);
    assert.ok(!/^(latest|main|master|develop|HEAD)$/i.test(ref), `${step.uses} is not pinned`);
    assert.match(ref, /^v?\d+(\.\d+){0,2}$/, `${step.uses} must be a version tag`);
    assert.ok(name in ALLOWED, `${name} is not on the allowed list`);
    assert.equal(ref, ALLOWED[name], `${name} must be pinned to ${ALLOWED[name]}`);
  }
});

test('only the allowed actions are used (and each of them is used)', () => {
  const used = new Set(allSteps.filter((s) => s.uses).map((s) => s.uses.split('@')[0]));
  assert.deepEqual([...used].sort(), Object.keys(ALLOWED).sort());
});

test('permissions: read-only at the top, security-events: write only on the CodeQL job', () => {
  assert.deepEqual(doc.permissions, { contents: 'read' });
  for (const [name, job] of Object.entries(jobs)) {
    if (name === 'codeql') {
      assert.deepEqual(job.permissions, { contents: 'read', 'security-events': 'write' });
    } else {
      assert.equal(job.permissions, undefined, `${name} must inherit the read-only default`);
    }
  }
  assert.ok(!JSON.stringify(doc).includes('write-all'));
});

test('every job has a timeout', () => {
  for (const [name, job] of Object.entries(jobs)) {
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 120, `${name} needs timeout-minutes`);
  }
});

test('concurrency: one group per ref, cancelling superseded pull-request runs only', () => {
  assert.match(doc.concurrency.group, /\$\{\{ github\.ref \}\}/);
  assert.match(String(doc.concurrency['cancel-in-progress']), /github\.event_name == 'pull_request'/);
});

test('tool versions are in a commented env block', async () => {
  for (const key of ['NODE_VERSION', 'GITLEAKS_VERSION', 'TRIVY_VERSION', 'ZAP_IMAGE']) assert.ok(doc.env[key], key);
  assert.match(doc.env.NODE_VERSION, /^20\./);
  assert.match(doc.env.ZAP_IMAGE, /:\d+\.\d+\.\d+$/);
  const raw = await readFile(workflowFile, 'utf8');
  assert.match(raw, /bump the ONE line below/);
});

test('node steps use Node 20.x', () => {
  const setups = allSteps.filter((s) => s.uses?.startsWith('actions/setup-node'));
  assert.ok(setups.length >= 2);
  for (const step of setups) assert.equal(step.with['node-version'], '${{ env.NODE_VERSION }}');
});

test('secrets job: gitleaks with the full history', () => {
  const checkout = steps(jobs.secrets).find((s) => s.uses?.startsWith('actions/checkout'));
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.ok(steps(jobs.secrets).some((s) => s.uses === 'gitleaks/gitleaks-action@v2'));
});

test('dockerfiles job: hadolint on both Dockerfiles', () => {
  const targets = steps(jobs.dockerfiles).filter((s) => s.uses?.startsWith('hadolint/')).map((s) => s.with.dockerfile);
  assert.deepEqual(targets.sort(), ['client/Dockerfile', 'server/Dockerfile']);
});

test('codeql job: javascript-typescript, security-extended, only for non-private repositories', () => {
  assert.equal(jobs.codeql.if, 'github.event.repository.private == false');
  const init = steps(jobs.codeql).find((s) => s.uses === 'github/codeql-action/init@v3');
  assert.equal(init.with.languages, 'javascript-typescript');
  assert.equal(init.with.queries, 'security-extended');
  assert.ok(steps(jobs.codeql).some((s) => s.uses === 'github/codeql-action/analyze@v3'));
});

test('images job: both images built with buildx, then Trivy on CRITICAL,HIGH, fixed only, failing the job', () => {
  const runs = steps(jobs.images).map((s) => s.run ?? '').join('\n');
  assert.match(runs, /docker buildx build .*-f server\/Dockerfile/);
  assert.match(runs, /docker buildx build .*-f client\/Dockerfile/);
  assert.ok(steps(jobs.images).some((s) => s.uses === 'docker/setup-buildx-action@v3'));
  const trivy = steps(jobs.images).filter((s) => s.uses === 'aquasecurity/trivy-action@0.28.0');
  assert.equal(trivy.length, 2);
  for (const step of trivy) {
    assert.equal(step.with.severity, 'CRITICAL,HIGH');
    assert.equal(step.with['ignore-unfixed'], true);
    assert.equal(String(step.with['exit-code']), '1');
  }
});

test('dynamic job: only on schedule and workflow_dispatch, runs verify, rbac probe and ZAP in that order', () => {
  const condition = jobs.dynamic.if;
  assert.match(condition, /github\.event_name == 'schedule'/);
  assert.match(condition, /github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(condition, /pull_request|push/);

  const runs = steps(jobs.dynamic).filter((s) => s.run).map((s) => s.run);
  const at = (needle) => runs.findIndex((r) => r.includes(needle));
  const verify = at('scripts/docker-verify/run.mjs');
  const rbac = at('scripts/security/rbac-live.mjs');
  const zap = at('scripts/security/zap-baseline.sh');
  assert.ok(verify >= 0 && rbac > verify && zap > rbac, 'order: docker-verify, rbac-live, zap-baseline');
  assert.match(runs[verify], /--host localhost --keep --skip-drills --out verify-report/);
  assert.match(runs[rbac], /--api http:\/\/localhost\/api/);
  assert.match(runs[rbac], /--out rbac-report\.json/);
  assert.match(runs[zap], /--target http:\/\/localhost --out zap-report/);
});

test('dynamic job reads the credentials from verify-report/private/credentials.json, never from the report root', () => {
  const text = JSON.stringify(jobs.dynamic);
  assert.ok(text.includes('verify-report/private/credentials.json'));
  assert.doesNotMatch(text.replaceAll('verify-report/private/credentials.json', ''), /verify-report\/credentials\.json/);
  const rbac = steps(jobs.dynamic).find((s) => s.run?.includes('rbac-live.mjs'));
  assert.match(rbac.run, /--credentials-file verify-report\/private\/credentials\.json/);
  assert.doesNotMatch(rbac.run, /--admin-password|--member-password/, 'no password on a command line');
});

test('dynamic job uploads verify-report, zap-report and rbac-report.json even when a step failed', () => {
  const uploads = steps(jobs.dynamic).filter((s) => s.uses === 'actions/upload-artifact@v4');
  const covers = (needle) => uploads.filter((u) => String(u.with.path).split('\n').some((p) => p.trim().replace(/^!/, '').startsWith(needle)));
  for (const needle of ['verify-report', 'zap-report', 'rbac-report.json']) {
    const matching = covers(needle);
    assert.ok(matching.length >= 1, `${needle} is uploaded`);
    for (const upload of matching) assert.equal(upload.if, 'always()', `${needle} upload runs if: always()`);
  }
});

test('every artifact step that covers verify-report excludes its private folder (the test credentials)', () => {
  const uploads = allSteps.filter((s) => s.uses?.startsWith('actions/upload-artifact'));
  const covering = uploads.filter((u) => String(u.with.path).split('\n').some((p) => /(^|\/)verify-report(\/|$)/.test(p.trim().replace(/^!/, ''))));
  assert.ok(covering.length >= 1);
  for (const upload of covering) {
    const lines = String(upload.with.path).split('\n').map((l) => l.trim()).filter(Boolean);
    assert.ok(lines.includes('verify-report/'), 'verify-report/ is uploaded');
    assert.ok(lines.includes('!verify-report/private/**'), `${upload.name}: must list !verify-report/private/**`);
    assert.ok(lines.indexOf('!verify-report/private/**') > lines.indexOf('verify-report/'), 'the exclusion comes after the inclusion');
  }
  // nothing else may upload the private folder either
  for (const upload of uploads) {
    const lines = String(upload.with.path).split('\n').map((l) => l.trim());
    assert.ok(!lines.some((l) => !l.startsWith('!') && /verify-report\/private/.test(l)), `${upload.name} uploads the private folder`);
  }
  // and the credentials are removed at the end
  assert.ok(steps(jobs.dynamic).some((s) => s.if === 'always()' && /rm -rf verify-report\/private/.test(s.run ?? '')));
});

test('every script path referenced in a run: step exists in the repository', () => {
  const referenced = new Set();
  for (const step of allSteps.filter((s) => s.run)) {
    for (const match of step.run.matchAll(/(?:^|[\s"'=])((?:scripts|server|client|docs|nginx)\/[A-Za-z0-9_./-]*[A-Za-z0-9_])/g)) referenced.add(match[1]);
  }
  assert.ok(referenced.size >= 6, `found ${[...referenced]}`);
  for (const file of referenced) assert.ok(existsSync(path.join(root, file)), `${file} is referenced by a run: step but does not exist`);
  for (const expected of ['scripts/security/static-scan.mjs', 'scripts/security/rbac-live.mjs', 'scripts/security/zap-baseline.sh', 'scripts/docker-verify/run.mjs', 'server/Dockerfile', 'client/Dockerfile']) {
    assert.ok([...referenced].includes(expected), `${expected} should be used by the workflow`);
  }
});

test('the workflow does not interpolate untrusted event data into run: steps', async () => {
  const raw = await readFile(workflowFile, 'utf8');
  for (const risky of ['github.event.pull_request.title', 'github.event.pull_request.body', 'github.head_ref', 'github.event.issue', 'github.event.comment']) {
    assert.ok(!raw.includes(risky), `${risky} must not appear`);
  }
});
