/**
 * Production configuration checks.
 *
 * `findProductionProblems` is a pure function of the environment, so the same rules run in three places:
 *  - at start-up when NODE_ENV=production (`assertProductionConfig`): the API refuses to boot on an unsafe configuration
 *  - in `npm run preflight` (scripts/preflight.ts), which a person runs before go-live and which also inspects the database
 *  - in the unit tests
 *
 * Two kinds of problem:
 *  - errors that are never acceptable (forgeable tokens, a known or empty database password, rate limiting switched
 *    off) cannot be waived
 *  - errors that only matter on the public internet (http/localhost URLs, no mail server, test payment keys, sample
 *    data) can be waived with ALLOW_INSECURE_PRODUCTION_CONFIG=true, which downgrades them to loud warnings. That is
 *    for trying the production build on one machine, never for a real deployment.
 */

import { log as logger } from '../utils/logger';
import { readKafkaSettings } from './kafka';

export interface ConfigFinding {
  code: string;
  level: 'error' | 'warning';
  /** An error that ALLOW_INSECURE_PRODUCTION_CONFIG may downgrade to a warning. */
  waivable: boolean;
  message: string;
  /** What to change. */
  fix: string;
}

export interface ConfigEvaluation {
  ok: boolean;
  errors: ConfigFinding[];
  warnings: ConfigFinding[];
}

/** Database passwords that were committed to this repository's history (treat them as public). */
export const LEAKED_DB_PASSWORDS: readonly string[] = ['AitdTech@2026'];

const COMMON_DB_PASSWORDS = new Set(['postgres', 'password', 'admin', 'root', 'test', 'secret', 'aitd', 'aiem', 'alumni']);
const PLACEHOLDER = /change[-_ ]?me|your[-_ ]|example|placeholder|^default[-_]|todo|xxxx/i;
const LOCAL_HOST = /(^|\/\/|@)(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\])([:/]|$)/i;

const isTrue = (value: string | undefined) => ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase());
const present = (value: string | undefined) => (value ?? '').trim().length > 0;

const weakSecret = (value: string | undefined): boolean =>
  !value || value.length < 32 || PLACEHOLDER.test(value) || new Set(value).size < 10;

/** E-mail verification is on unless it was switched off on purpose (it is the production default). */
const verificationRequired = (env: NodeJS.ProcessEnv): boolean => {
  const raw = env.REQUIRE_EMAIL_VERIFICATION;
  return present(raw) ? isTrue(raw) : true;
};

const mailConfigured = (env: NodeJS.ProcessEnv): boolean =>
  present(env.SENDGRID_API_KEY) || (present(env.SMTP_HOST) && present(env.SMTP_USER) && present(env.SMTP_PASS));

const databasePassword = (url: string | undefined): { password: string; raw: string } => {
  const raw = url ?? '';
  try {
    return { password: decodeURIComponent(new URL(raw).password), raw };
  } catch {
    return { password: '', raw };
  }
};

/** jsonwebtoken lifetime ("15m", "1h", "900", ...) in seconds; NaN when it cannot be read. */
const lifetimeSeconds = (value: string): number => {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(value.trim());
  if (!match) return Number.NaN;
  const factor = { s: 1, m: 60, h: 3600, d: 86_400 }[(match[2] || 's').toLowerCase() as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * factor;
};

const originProblems = (origins: string | undefined): string[] =>
  (origins ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .filter((o) => o === '*' || !/^https:\/\//i.test(o) || LOCAL_HOST.test(o));

export const findProductionProblems = (env: NodeJS.ProcessEnv): ConfigFinding[] => {
  const found: ConfigFinding[] = [];
  const error = (code: string, waivable: boolean, message: string, fix: string) =>
    found.push({ code, level: 'error', waivable, message, fix });
  const warning = (code: string, message: string, fix: string) =>
    found.push({ code, level: 'warning', waivable: false, message, fix });

  // ---- secrets (never waivable) ----
  if (weakSecret(env.JWT_SECRET)) {
    error('JWT_SECRET_WEAK', false, 'JWT_SECRET is missing, short (< 32 characters) or a placeholder: anyone could forge sessions.',
      'Set JWT_SECRET to 48+ random characters: npm run secrets -w server');
  }
  if (weakSecret(env.JWT_REFRESH_SECRET)) {
    error('JWT_REFRESH_SECRET_WEAK', false, 'JWT_REFRESH_SECRET is missing, short (< 32 characters) or a placeholder.',
      'Set JWT_REFRESH_SECRET to 48+ random characters, different from JWT_SECRET: npm run secrets -w server');
  } else if (env.JWT_SECRET && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    error('JWT_SECRETS_IDENTICAL', false, 'JWT_SECRET and JWT_REFRESH_SECRET are the same value, so one token type can stand in for the other.',
      'Generate two independent secrets: npm run secrets -w server');
  }

  const { password: dbPassword, raw: dbUrl } = databasePassword(env.DATABASE_URL);
  if (LEAKED_DB_PASSWORDS.some((leaked) => dbUrl.includes(leaked) || dbUrl.includes(encodeURIComponent(leaked)) || dbPassword === leaked)) {
    error('DB_PASSWORD_LEAKED', false, 'The database password is one that was committed to this repository. It is public: treat it as compromised.',
      'Rotate it in PostgreSQL (ALTER USER ... PASSWORD) and put the new value in the environment only.');
  } else if (
    dbPassword.length < 12 ||
    PLACEHOLDER.test(dbPassword) ||
    COMMON_DB_PASSWORDS.has(dbPassword.toLowerCase()) ||
    new Set(dbPassword).size < 6
  ) {
    error('DB_PASSWORD_WEAK', false, 'The database password is empty, short (< 12 characters), a placeholder or a common default.',
      'Use a random 24+ character password for POSTGRES_PASSWORD / DATABASE_URL: npm run secrets -w server');
  }

  if (isTrue(env.DISABLE_RATE_LIMIT)) {
    error('RATE_LIMIT_DISABLED', false, 'DISABLE_RATE_LIMIT=true switches off every rate limit, including login.',
      'Remove DISABLE_RATE_LIMIT from the production environment.');
  }

  // ---- exposure (waivable for a trial on one machine) ----
  if (!present(env.CORS_ORIGINS) || originProblems(env.CORS_ORIGINS).length > 0) {
    error('CORS_ORIGINS_INSECURE', true, 'CORS_ORIGINS is unset or lists localhost, a wildcard or a non-https origin.',
      'Set CORS_ORIGINS to the exact https:// origin(s) of the web app, e.g. https://alumni.example.edu');
  }
  if (!present(env.FRONTEND_URL) || originProblems(env.FRONTEND_URL).length > 0) {
    error('FRONTEND_URL_INSECURE', true, 'FRONTEND_URL is unset, uses http or points at localhost: e-mail links would be wrong.',
      'Set FRONTEND_URL to the public https:// address of the web app.');
  }

  // ---- e-mail ----
  if (!verificationRequired(env)) {
    warning('EMAIL_VERIFICATION_OFF', 'REQUIRE_EMAIL_VERIFICATION is off: anyone can use an account registered with an address they do not own.',
      'Remove REQUIRE_EMAIL_VERIFICATION (it defaults to on in production).');
  } else if (!mailConfigured(env)) {
    error('EMAIL_NOT_CONFIGURED', true, 'E-mail verification is required but no mail server is configured, so nobody could finish registering.',
      'Set SENDGRID_API_KEY, or SMTP_HOST + SMTP_USER + SMTP_PASS (and EMAIL_FROM).');
  }

  // ---- payments ----
  if (present(env.RAZORPAY_KEY_ID)) {
    if (!present(env.RAZORPAY_WEBHOOK_SECRET)) {
      error('RAZORPAY_WEBHOOK_SECRET_MISSING', true, 'Razorpay is configured without RAZORPAY_WEBHOOK_SECRET: the webhook is refused, so payments never complete.',
        'Set the secret you configured on the Razorpay dashboard webhook (https://<api-host>/api/payments/webhook/razorpay).');
    }
    if ((env.RAZORPAY_KEY_ID ?? '').startsWith('rzp_test_')) {
      warning('RAZORPAY_TEST_KEYS', 'Razorpay is in TEST mode: no real money moves.', 'Use the live key id and secret for go-live.');
    }
  }

  if (isTrue(env.SEED_SAMPLE_DATA)) {
    error('SEED_SAMPLE_DATA_ON', true, 'SEED_SAMPLE_DATA=true would put demo users with known passwords into the production database.',
      'Remove SEED_SAMPLE_DATA (or set it to false).');
  }

  // ---- warnings ----
  if (present(env.SEED_ADMIN_PASSWORD) && (env.SEED_ADMIN_PASSWORD as string).length < 12) {
    warning('SEED_ADMIN_PASSWORD_WEAK', 'SEED_ADMIN_PASSWORD is shorter than 12 characters.', 'Use a long random password, then change it after the first sign-in.');
  }
  if (!present(env.REDIS_URL)) {
    warning('REDIS_MISSING', 'Redis is not configured: rate limits are per process, the response cache is off and background jobs (notification broadcasts, the weekly digest) do not run.',
      'Set REDIS_URL (docker-compose does this). Required before running more than one API instance.');
  }
  if (!present(env.KAFKA_BROKERS)) {
    warning('KAFKA_MISSING', 'Kafka is not configured: notifications and the e-mails to the college administrator and to applicants are delivered in-process. They still work, but nothing is queued across restarts and a slow mail server holds the API.',
      'Set KAFKA_BROKERS (docker-compose does this). See docs/KAFKA.md.');
  } else {
    const kafka = readKafkaSettings(env);
    if (kafka.problems.length > 0) {
      error('KAFKA_CONFIG_INVALID', false, `The Kafka settings are wrong: ${kafka.problems.join('; ')}.`, 'Fix the KAFKA_* settings (docs/KAFKA.md).');
    }
  }
  const notifyAddresses = (env.APPROVAL_NOTIFY_EMAIL ?? '').split(',').map((a) => a.trim()).filter(Boolean);
  const notMailboxes = notifyAddresses.filter((a) => !/^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/.test(a));
  if (notMailboxes.length > 0) {
    warning('APPROVAL_NOTIFY_EMAIL_INVALID', `APPROVAL_NOTIFY_EMAIL contains something that is not an e-mail address: ${notMailboxes.join(', ')}. The college office would not hear about waiting registrations.`,
      'Use plain addresses separated by commas (alumni-office@college.edu).');
  }
  if (!present(env.AWS_S3_BUCKET)) {
    warning('UPLOADS_ON_LOCAL_DISK', 'Uploads are stored on local disk.', 'Mount a persistent volume and back it up, or set AWS_S3_BUCKET (+ AWS credentials).');
  }
  if (['0', 'false'].includes((env.TRUST_PROXY ?? '').trim().toLowerCase())) {
    warning('TRUST_PROXY_NONE', 'TRUST_PROXY=0: behind a reverse proxy every visitor shares one rate-limit bucket.',
      'Set TRUST_PROXY to the number of proxies in front of the API (1 for nginx or one load balancer).');
  }
  if (present(env.JWT_EXPIRES_IN)) {
    const seconds = lifetimeSeconds(env.JWT_EXPIRES_IN as string);
    if (!(seconds <= 3600)) {
      warning('JWT_EXPIRES_TOO_LONG', `JWT_EXPIRES_IN=${env.JWT_EXPIRES_IN}: a stolen access token stays valid that long.`,
        'Use 15m (the default in production); the refresh token keeps members signed in.');
    }
  }

  return found;
};

export const evaluateProductionConfig = (env: NodeJS.ProcessEnv): ConfigEvaluation => {
  const waived = isTrue(env.ALLOW_INSECURE_PRODUCTION_CONFIG);
  const errors: ConfigFinding[] = [];
  const warnings: ConfigFinding[] = [];

  for (const finding of findProductionProblems(env)) {
    if (finding.level === 'error' && !(waived && finding.waivable)) errors.push(finding);
    else warnings.push(finding.level === 'error' ? { ...finding, level: 'warning' } : finding);
  }
  if (waived) {
    warnings.push({
      code: 'INSECURE_WAIVER_ACTIVE',
      level: 'warning',
      waivable: false,
      message: 'ALLOW_INSECURE_PRODUCTION_CONFIG is on: public-internet checks are only warnings. Use it to try the build on one machine, never for a real deployment.',
      fix: 'Remove ALLOW_INSECURE_PRODUCTION_CONFIG for go-live.',
    });
  }
  return { ok: errors.length === 0, errors, warnings };
};

/** Start-up guard: throws (so the process exits) when the production configuration has errors. */
export const assertProductionConfig = (env: NodeJS.ProcessEnv, emit: (line: string) => void = (line) => logger.warn(line)): void => {
  const { errors, warnings } = evaluateProductionConfig(env);
  for (const w of warnings) emit(`[config] warning ${w.code}: ${w.message} ${w.fix}`);
  if (errors.length > 0) {
    const lines = errors.map((e) => `  - ${e.code}: ${e.message}\n      fix: ${e.fix}`);
    throw new Error(`Unsafe production configuration, refusing to start:\n${lines.join('\n')}\nRun "npm run preflight -w server" for the full report.`);
  }
};
