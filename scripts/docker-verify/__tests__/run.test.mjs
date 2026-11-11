import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runVerification, parseCli } from '../run.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'verify-run-'));

describe('command line', () => {
  test('has sensible defaults and understands every option', () => {
    const defaults = parseCli([]);
    assert.equal(defaults.host, 'localhost');
    assert.equal(defaults.out, 'verify-report');
    assert.equal(defaults['skip-drills'], false);
    assert.equal(defaults.project, 'aiem-verify');
    const given = parseCli(['--host', 'atreya-2', '--keep', '--skip-drills', '--proxy-port', '8080', '--attach', 'http://x:5050']);
    assert.deepEqual([given.host, given.keep, given['skip-drills'], given['proxy-port'], given.attach], ['atreya-2', true, true, '8080', 'http://x:5050']);
    assert.throws(() => parseCli(['--nonsense']));
  });

  test('--help prints the usage and exits 0 without running anything', async () => {
    const lines = [];
    const result = await runVerification(['--help'], { log: (line) => lines.push(line), exec: async () => assert.fail('must not run anything') });
    assert.equal(result.exitCode, 0);
    assert.match(lines.join('\n'), /Usage: node scripts\/docker-verify\/run\.mjs/);
  });
});

describe('--down', () => {
  test('removes only the verification project and its volumes, and works without an env file (compose needs the required variables even to remove)', async () => {
    const calls = [];
    const exec = async (command, args, options) => {
      calls.push({ command, args, env: options?.env });
      return { code: 0, stdout: '', stderr: '' };
    };
    const result = await runVerification(['--down', '--out', path.join(tmp(), 'nothing-here')], { exec, log: () => {} });
    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 1);
    const { command, args, env } = calls[0];
    assert.equal(command, 'docker');
    assert.deepEqual(args.slice(0, 3), ['compose', '-p', 'aiem-verify']);
    assert.ok(args.includes('down') && args.includes('-v'));
    assert.ok(!args.includes('--env-file'), 'there is no env file to pass');
    assert.ok(env.JWT_SECRET && env.JWT_REFRESH_SECRET && env.POSTGRES_PASSWORD, 'placeholder values satisfy the required-variable checks');
  });

  test('uses the env file of the earlier run when it is there (so nothing is interpolated from placeholders)', async () => {
    const out = tmp();
    fs.mkdirSync(path.join(out, 'private'), { recursive: true });
    fs.writeFileSync(path.join(out, 'private', '.env.verify'), 'POSTGRES_PASSWORD=x\n');
    const calls = [];
    await runVerification(['--down', '--out', out], { exec: async (c, a) => (calls.push(a), { code: 0, stdout: '', stderr: '' }), log: () => {} });
    const args = calls[0];
    assert.equal(args[args.indexOf('--env-file') + 1], path.join(out, 'private', '.env.verify'));
  });

  test('reports a failed removal with a non-zero exit code', async () => {
    const lines = [];
    const result = await runVerification(['--down'], { exec: async () => ({ code: 1, stdout: '', stderr: 'daemon not running' }), log: (l) => lines.push(l) });
    assert.equal(result.exitCode, 1);
    assert.match(lines.join('\n'), /daemon not running/);
  });

  test('honours --project', async () => {
    const calls = [];
    await runVerification(['--down', '--project', 'other'], { exec: async (c, a) => (calls.push(a), { code: 0, stdout: '', stderr: '' }), log: () => {} });
    assert.equal(calls[0][2], 'other');
  });
});

describe('--attach', () => {
  test('refuses to start without administrator credentials', async () => {
    await assert.rejects(() => runVerification(['--attach', 'http://127.0.0.1:1', '--out', path.join(tmp(), 'o')], { log: () => {}, exec: async () => ({ code: 1, stdout: '', stderr: '' }) }), /--admin-email/);
  });
});
