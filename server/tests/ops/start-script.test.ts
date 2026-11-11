/**
 * ./start.sh is the documented one-command setup. It writes a .env and starts the stack with `docker compose`; the API then
 * runs with NODE_ENV=production and refuses to start on an unsafe configuration. These tests run the REAL script against a
 * stand-in `docker` command (this suite never runs Docker) and check that what it generates is accepted by that guard, and
 * that a crashed API is reported quickly with the reason instead of after a five-minute wait.
 */
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateProductionConfig } from '../../src/config/productionChecks';

const REPO = path.resolve(__dirname, '../../..');
const bashAvailable = spawnSync('bash', ['--version']).status === 0;
const describeIfBash = bashAvailable ? describe : describe.skip;

const DOCKER_SHIM = `#!/usr/bin/env bash
echo "docker $*" >> "$DOCKER_LOG"
case "$*" in
  "compose version") echo "Docker Compose version v2.29.0" ;;
  *"ps api"*State*) echo "\${FAKE_API_STATE:-running}" ;;
  *"ps api"*Health*) echo "\${FAKE_API_HEALTH:-healthy}" ;;
  *"ps web"*Health*) echo "healthy" ;;
  *"logs"*) echo "api  | Unsafe production configuration, refusing to start:" ;;
esac
exit 0
`;

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiem-start-'));
  fs.copyFileSync(path.join(REPO, 'start.sh'), path.join(dir, 'start.sh'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), DOCKER_SHIM, { mode: 0o755 });
  const run = (extraEnv: Record<string, string> = {}) =>
    spawnSync('bash', ['start.sh'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env.PATH}`, DOCKER_LOG: path.join(dir, 'docker.log'), START_POLL_SECONDS: '0', ...extraEnv },
    });
  const envFile = () => Object.fromEntries(
    fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
  );
  const dockerCalls = () => (fs.existsSync(path.join(dir, 'docker.log')) ? fs.readFileSync(path.join(dir, 'docker.log'), 'utf8') : '');
  return { dir, run, envFile, dockerCalls };
};

describeIfBash('./start.sh', () => {
  it('is valid bash', () => {
    expect(() => execFileSync('bash', ['-n', path.join(REPO, 'start.sh')])).not.toThrow();
  });

  it('generates an .env that the production guard accepts (local trial: no domain, no mail server)', () => {
    const { run, envFile } = setup();
    expect(run().status).toBe(0);
    const env = envFile();

    // what docker-compose.yml builds for the api container from this .env
    const composed = {
      ...env,
      NODE_ENV: 'production',
      DATABASE_URL: `postgresql://${env.POSTGRES_USER}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@postgres:5432/${env.POSTGRES_DB}`,
      REDIS_URL: 'redis://redis:6379',
    };
    const result = evaluateProductionConfig(composed);

    expect(result.errors.map((e) => e.code)).toEqual([]);
    // ...and it says out loud that this is not a production configuration
    expect(result.warnings.map((w) => w.code)).toContain('INSECURE_WAIVER_ACTIVE');
  });

  it('marks the trial settings in the file so nobody ships them by accident', () => {
    const { run, dir } = setup();
    run();
    const text = fs.readFileSync(path.join(dir, '.env'), 'utf8');
    expect(text).toMatch(/ALLOW_INSECURE_PRODUCTION_CONFIG=true/);
    expect(text).toMatch(/REQUIRE_EMAIL_VERIFICATION=false/);
    expect(text).toMatch(/PRODUCTION_CHECKLIST/);
  });

  it('generates long random secrets, different every time, and never prints them', () => {
    const first = setup();
    const second = setup();
    const out = first.run();
    second.run();
    const a = first.envFile();
    const b = second.envFile();

    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'POSTGRES_PASSWORD']) {
      expect(a[key].length).toBeGreaterThanOrEqual(32);
      expect(a[key]).not.toBe(b[key]);
      expect(out.stdout + out.stderr).not.toContain(a[key]);
    }
    expect(a.JWT_SECRET).not.toBe(a.JWT_REFRESH_SECRET);
  });

  it('still generates strong secrets on a machine with no working Node (a Docker-only server)', () => {
    // A `node` that exists on the PATH but cannot run (an unselected nvm version, a placeholder shim) must not break setup.
    const { dir, run, envFile } = setup();
    const brokenNode = ['#!/usr/bin/env bash', 'echo "node: command failed" >&2', 'exit 127', ''].join('\n');
    fs.writeFileSync(path.join(dir, 'bin', 'node'), brokenNode, { mode: 0o755 });
    const out = run();

    expect(out.status).toBe(0);
    const env = envFile();
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'POSTGRES_PASSWORD']) {
      expect(env[key]).toMatch(/^[A-Za-z0-9_-]{32,}$/);
      expect(out.stdout + out.stderr).not.toContain(env[key]);
    }
    expect(env.JWT_SECRET).not.toBe(env.JWT_REFRESH_SECRET);
    expect(env.SEED_ADMIN_PASSWORD.length).toBeGreaterThanOrEqual(12);
  });

  it('keeps the existing .env (and so the data and the admin password) when run again', () => {
    const { run, envFile } = setup();
    run();
    const before = envFile();
    run();
    expect(envFile()).toEqual(before);
  });

  it('starts the stack with docker compose', () => {
    const { run, dockerCalls } = setup();
    run();
    expect(dockerCalls()).toContain('docker compose up -d --build');
  });

  it('when the API container dies it stops waiting at once and prints the reason, and exits non-zero', () => {
    const { run } = setup();
    const result = run({ FAKE_API_STATE: 'exited' });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Unsafe production configuration');
    expect(result.stdout + result.stderr).toMatch(/docs\/PRODUCTION_CHECKLIST\.md|preflight/);
  });
});
