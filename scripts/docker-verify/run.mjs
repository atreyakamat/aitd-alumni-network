#!/usr/bin/env node
// Docker and Kafka verification for AIEM Connect. Brings the compose stack up in its own project ("aiem-verify", so a real
// stack on the same machine is untouched), runs every gate in gates.mjs, writes an evidence bundle and tears everything down.
//
//   node scripts/docker-verify/run.mjs --host atreya-2          full run on a Docker host
//   node scripts/docker-verify/run.mjs --skip-drills            skip the break-it-on-purpose drills
//   node scripts/docker-verify/run.mjs --keep                   leave the stack running afterwards (the security scans use it)
//   node scripts/docker-verify/run.mjs --down                   remove the verification stack and its data
//   node scripts/docker-verify/run.mjs --attach http://localhost:5050 --admin-email E --admin-password P [--web URL] [--mailpit URL]
//        runs the gates that only need HTTP against a stack that is already running (no Docker needed).
//
// Needs Node 20+, Docker Engine 24+ and Docker Compose v2.20+ (not for --attach). Guide: docs/DOCKER_TEST_GUIDE.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { run as defaultExec } from './lib/exec.mjs';
import { createCompose } from './lib/compose.mjs';
import { createClient } from './lib/http.mjs';
import { createMailpit } from './lib/mailpit.mjs';
import { createKafkaTools } from './lib/kafka.mjs';
import { createReport } from './lib/report.mjs';
import { makeEnv, ADMIN_EMAIL } from './lib/envfile.mjs';
import { buildGates, createHelpers, runGates } from './gates.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..');

const OPTIONS = {
  host: { type: 'string', default: 'localhost' },
  out: { type: 'string', default: 'verify-report' },
  keep: { type: 'boolean', default: false },
  'skip-drills': { type: 'boolean', default: false },
  'no-build': { type: 'boolean', default: false },
  down: { type: 'boolean', default: false },
  project: { type: 'string', default: 'aiem-verify' },
  'wait-sec': { type: 'string', default: '900' },
  'proxy-port': { type: 'string', default: '80' },
  'web-port': { type: 'string', default: '3000' },
  'api-port': { type: 'string', default: '5000' },
  'postgres-port': { type: 'string', default: '5432' },
  'mailpit-port': { type: 'string', default: '8025' },
  attach: { type: 'string' },
  web: { type: 'string' },
  mailpit: { type: 'string' },
  'admin-email': { type: 'string' },
  'admin-password': { type: 'string' },
  'verification-required': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

export const parseCli = (argv) => parseArgs({ args: argv, options: OPTIONS, allowPositionals: false }).values;

const HELP = `Usage: node scripts/docker-verify/run.mjs [options]

  --host <name>          name the stack is reached by from a browser (default localhost; e.g. atreya-2)
  --out <dir>            evidence folder (default verify-report)
  --skip-drills          skip the outage, restart and poison-message drills
  --keep                 leave the stack running and write <out>/private/credentials.json
  --no-build             reuse images that are already built
  --down                 remove the verification stack and its volumes, then exit
  --project <name>       compose project name (default aiem-verify)
  --proxy-port/--web-port/--api-port/--postgres-port/--mailpit-port <n>   host ports (defaults 80/3000/5000/5432/8025)
  --attach <api base>    do not start anything: run the HTTP gates against a running stack (needs --admin-email, --admin-password)
  --web <url>            web address for the attach mode      --mailpit <url>   mail catcher for the attach mode
  --verification-required   the attached stack requires e-mail verification (needs --mailpit)
`;

const git = async (exec, args) => (await exec('git', args, { cwd: REPO_ROOT })).stdout.trim();

const collectEvidence = async (ctx, report) => {
  const note = (name, result) => report.evidence(name, `${result.stdout}\n${result.stderr}`);
  const { exec, compose } = ctx;
  if (compose) {
    note('compose-ps.txt', await compose.raw(['ps', '--all']));
    for (const service of ['postgres', 'redis', 'kafka', 'api', 'web', 'nginx', 'mailpit']) {
      note(`logs-${service}.txt`, await compose.logs(service, { tail: 500 }));
    }
    note('docker-version.txt', await exec('docker', ['version']));
    note('docker-info.txt', await exec('docker', ['info', '--format', 'Server {{.ServerVersion}}, {{.OperatingSystem}}, {{.Architecture}}, {{.NCPU}} CPU, {{.MemTotal}} bytes RAM, storage {{.Driver}}']));
    note('images.txt', await exec('docker', ['image', 'ls', '--digests', '--format', '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}', '--filter', `label=com.docker.compose.project=${compose.project}`]));
  }
  report.evidence('host.txt', `${os.hostname()}\n${os.type()} ${os.release()} ${os.arch()}\nnode ${process.version}\nCPUs ${os.cpus().length}\nRAM ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB\n`);
};

export const runVerification = async (argv, deps = {}) => {
  const options = parseCli(argv);
  const exec = deps.exec ?? defaultExec;
  const log = deps.log ?? ((line) => console.log(line));
  if (options.help) {
    log(HELP);
    return { exitCode: 0 };
  }

  const outDir = path.resolve(options.out);
  const privateDir = path.join(outDir, 'private');
  const attach = Boolean(options.attach);

  // ---- the project to tear down only
  if (options.down) {
    // Compose insists on the required variables (JWT_SECRET ...) even to remove containers. Use the env file of the earlier run when
    // it is there; otherwise placeholders: nothing is started, so their values never matter.
    const envFile = path.join(privateDir, '.env.verify');
    const haveEnvFile = fs.existsSync(envFile);
    const placeholders = { JWT_SECRET: 'placeholder', JWT_REFRESH_SECRET: 'placeholder', POSTGRES_PASSWORD: 'placeholder' };
    const downExec = haveEnvFile ? exec : (command, args, execOptions = {}) => exec(command, args, { ...execOptions, env: { ...placeholders, ...execOptions.env } });
    const compose = createCompose({ exec: downExec, cwd: REPO_ROOT, project: options.project, envFile: haveEnvFile ? envFile : undefined });
    const result = await compose.down({ volumes: true });
    log(result.code === 0 ? `Removed project ${options.project} and its volumes.` : `docker compose down failed: ${result.stderr.trim()}`);
    return { exitCode: result.code === 0 ? 0 : 1 };
  }

  // The state of the code that is tested, read BEFORE the evidence folder exists (it lives inside the repository)
  const commit = await git(exec, ['rev-parse', 'HEAD']);
  const dirty = (await git(exec, ['status', '--porcelain'])).length > 0;

  fs.mkdirSync(privateDir, { recursive: true });
  const report = createReport({ outDir, secrets: [] });
  const runId = crypto.randomBytes(3).toString('hex');
  const ports = {
    proxy: Number(options['proxy-port']),
    web: Number(options['web-port']),
    api: Number(options['api-port']),
    postgres: Number(options['postgres-port']),
    mailpit: Number(options['mailpit-port']),
  };

  const ctx = {
    runId,
    exec,
    log,
    report,
    state: {},
    secrets: [],
    helpers: null,
    compose: null,
    kafka: null,
    mail: null,
    web: null,
    http: null,
    admin: null,
    verificationRequired: false,
    config: {
      repoRoot: REPO_ROOT,
      prefix: 'aiem',
      groupId: 'aiem-notifications',
      partitions: 3,
      skipDrills: options['skip-drills'],
      noBuild: options['no-build'],
      waitSec: Number(options['wait-sec']),
      expectOfficeMailbox: !attach,
      ports,
    },
  };

  let envInfo = null;
  if (attach) {
    ctx.http = createClient(options.attach);
    if (options.web) ctx.web = createClient(options.web);
    if (options.mailpit) ctx.mail = createMailpit(options.mailpit);
    must(options['admin-email'] && options['admin-password'], '--attach needs --admin-email and --admin-password');
    ctx.admin = { email: String(options['admin-email']).toLowerCase(), password: options['admin-password'] };
    ctx.verificationRequired = options['verification-required'];
    report.addSecrets([options['admin-password']]);
  } else {
    envInfo = makeEnv({
      host: options.host,
      proxyPort: ports.proxy,
      webPort: ports.web,
      apiPort: ports.api,
      postgresPort: ports.postgres,
      mailpitPort: ports.mailpit,
    });
    const envFile = path.join(privateDir, '.env.verify');
    fs.writeFileSync(envFile, envInfo.text, { mode: 0o600 });
    ctx.secrets = envInfo.secrets;
    report.addSecrets(envInfo.secrets);
    ctx.compose = createCompose({ exec, cwd: REPO_ROOT, project: options.project, envFile });
    ctx.kafka = createKafkaTools(ctx.compose);
    ctx.http = createClient(`http://127.0.0.1:${ports.proxy}`);
    ctx.web = ctx.http;
    ctx.mail = createMailpit(`http://127.0.0.1:${ports.mailpit}`);
    ctx.admin = { email: envInfo.adminEmail, password: envInfo.adminPassword };
    ctx.verificationRequired = true;
  }
  ctx.helpers = createHelpers(ctx);

  log(`AIEM Connect Docker/Kafka verification  run ${runId}  ${attach ? `(attached to ${options.attach})` : `(project ${options.project}, host ${options.host})`}`);
  log(`Evidence folder: ${outDir}\n`);

  if (ctx.compose) {
    // A leftover of an earlier run (same project name) must not influence this one. Only this project is touched.
    await ctx.compose.down({ volumes: true });
  }

  let exitCode = 1;
  try {
    await runGates(ctx, buildGates());
  } finally {
    try {
      await collectEvidence(ctx, report);
    } catch (error) {
      log(`(could not collect all evidence: ${error.message})`);
    }

    const finished = report.finish({
      commit,
      dirty,
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} ${os.arch()}`,
      node: process.version,
      dockerVersion: ctx.state.dockerVersion,
      composeVersion: ctx.state.composeVersion,
      mode: attach ? `attach ${options.attach}` : `compose project ${options.project}, host ${options.host}, drills ${options['skip-drills'] ? 'skipped' : 'run'}`,
    });
    exitCode = finished.ok ? 0 : 1;

    if (ctx.compose && options.keep && ctx.state.stackUp) {
      const a = ctx.state.applicantA;
      fs.writeFileSync(
        path.join(privateDir, 'credentials.json'),
        JSON.stringify({ adminEmail: ctx.admin.email, adminPassword: ctx.admin.password, memberEmail: a?.email ?? null, memberPassword: a?.password ?? null }, null, 2),
        { mode: 0o600 }
      );
      log(`\nThe stack is still running (--keep). Test credentials: ${path.join(privateDir, 'credentials.json')}`);
      log(`  App:  http://${options.host}${ports.proxy === 80 ? '' : `:${ports.proxy}`}    Mail catcher: http://127.0.0.1:${ports.mailpit}`);
      log(`  Remove it when done:  node scripts/docker-verify/run.mjs --down`);
    } else if (ctx.compose) {
      const down = await ctx.compose.down({ volumes: true });
      log(`\nStack removed (${down.code === 0 ? 'ok' : `docker compose down exit ${down.code}`}).`);
    }

    const c = finished.counts;
    log(`\n${finished.ok ? 'PASS' : 'FAIL'}: ${c.pass} passed, ${c.fail} failed, ${c.skip} skipped.  Report: ${path.join(outDir, 'REPORT.md')}`);
  }
  return { exitCode, ctx };
};

const must = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Run as a program (not when imported by the tests)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runVerification(process.argv.slice(2)).then(
    ({ exitCode }) => process.exit(exitCode),
    (error) => {
      console.error(`verification stopped: ${error.message}`);
      process.exit(2);
    }
  );
}
