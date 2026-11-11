import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptFile = path.join(dir, 'zap-baseline.sh');
const rulesFile = path.join(dir, 'zap-rules.tsv');
const script = await readFile(scriptFile, 'utf8');
const rules = await readFile(rulesFile, 'utf8');

const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' });
// Running the script needs a POSIX bash; on a Windows machine `bash` may be a WSL stub, so only run it where it is Linux/macOS
const canRun = process.platform !== 'win32' && bash.stdout?.trim() === 'ok';

test('zap-baseline.sh: bash, strict mode, LF line endings, pinned image, host network, rule file', () => {
  assert.ok(script.startsWith('#!/usr/bin/env bash\n'));
  assert.ok(!script.includes('\r'), 'no CRLF (it would break bash)');
  assert.match(script, /^set -euo pipefail$/m);
  assert.match(script, /ZAP_IMAGE="\$\{ZAP_IMAGE:-ghcr\.io\/zaproxy\/zaproxy:2\.15\.0\}"/);
  assert.doesNotMatch(script, /zaproxy:(latest|stable|weekly)/);
  assert.match(script, /--network host/);
  assert.match(script, /-v "\$OUT":\/zap\/wrk:rw/);
  assert.match(script, /zap-baseline\.py/);
  assert.match(script, /-c zap-rules\.tsv/);
  assert.match(script, /-r zap\.html -J zap\.json -w zap\.md/);
  assert.match(script, /--fail-on/);
  assert.match(script, /docker is not installed or not on PATH/);
});

test('zap-rules.tsv: tab separated, valid actions, unique ids, a comment above every rule', () => {
  const lines = rules.split('\n');
  const seen = new Set();
  let count = 0;
  lines.forEach((line, i) => {
    if (!line || line.startsWith('#')) return;
    const fields = line.split('\t');
    assert.equal(fields.length, 3, `line ${i + 1} needs 3 tab-separated fields: ${line}`);
    assert.match(fields[0], /^\d{4,6}$/);
    assert.ok(['IGNORE', 'INFO', 'WARN', 'FAIL'].includes(fields[1]), `line ${i + 1} action`);
    assert.ok(fields[2].trim(), `line ${i + 1} has a name`);
    assert.ok(!seen.has(fields[0]), `rule ${fields[0]} listed twice`);
    seen.add(fields[0]);
    // the nearest non-empty line above is a comment explaining the rule
    let j = i - 1;
    while (j >= 0 && !lines[j].trim()) j--;
    assert.ok(lines[j]?.startsWith('#'), `rule ${fields[0]} (line ${i + 1}) has no comment above it`);
    count++;
  });
  assert.ok(count >= 8);
  assert.ok(!rules.includes('\r'));
  // the headers the app sets everywhere must fail the scan when they disappear
  for (const id of ['10020', '10021', '10037', '10038']) assert.match(rules, new RegExp(`^${id}\\tFAIL\\t`, 'm'));
});

test('zap-baseline.sh passes a bash syntax check', { skip: bash.status !== 0 && 'bash not available' }, () => {
  const result = spawnSync('bash', ['-n', scriptFile], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('zap-baseline.sh --help exits 0; bad arguments and non-test targets exit 2 before docker is touched', { skip: !canRun && 'needs Linux/macOS bash' }, async () => {
  const run = (args) => exec('bash', [scriptFile, ...args]).then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));
  assert.equal((await run(['--help'])).code, 0);
  const noTarget = await run([]);
  assert.equal(noTarget.code, 2);
  assert.match(noTarget.stderr, /--target is required/);
  assert.equal((await run(['--target', 'ftp://x'])).code, 2);
  const badFail = await run(['--target', 'http://localhost', '--fail-on', 'maybe']);
  assert.equal(badFail.code, 2);
  assert.match(badFail.stderr, /--fail-on must be/);
  const remote = await run(['--target', 'https://www.example.edu']);
  assert.equal(remote.code, 2);
  assert.match(remote.stderr, /does not look like a test stack/);
});
