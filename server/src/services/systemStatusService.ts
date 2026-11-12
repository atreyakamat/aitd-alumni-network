import fs from 'fs';
import path from 'path';
import config from '../config';
import prisma from '../config/database';
import redis from '../config/redis';
import { getKafka, getProducer, kafkaStatus, readKafkaSettings, type KafkaState } from '../config/kafka';
import { log } from '../utils/logger';
import { MAX_ADMINS_NOTIFIED, registrationAlertAdmins, sharedMailboxes } from './notificationEventHandlers';
import { readQueueBacklog } from './deadLetterService';

/**
 * System status for the college administrator (GET /api/admin/system-status).
 *
 * One line per thing the platform depends on, each with a short plain-English `detail` the administrator can act on.
 * Rules that keep it safe to show:
 *  - no host names, user names, passwords, keys, bucket names or addresses: only yes/no, modes and counts;
 *  - one failing check only degrades its own line (it never fails the whole call, and no error text or stack trace
 *    is ever returned: details are fixed sentences);
 *  - every check has a time limit, so the page answers even when a server it depends on hangs.
 *
 * All outside knowledge comes in through `SystemStatusDeps`, so the logic is unit-tested without a database, a broker or
 * environment variables; `defaultSystemStatusDeps` wires the real ones.
 */

export type ServiceStatus = 'ok' | 'warning' | 'error' | 'off';
export type OverallStatus = 'ok' | 'warning' | 'error';

export interface ServiceReport {
  key: string;
  label: string;
  status: ServiceStatus;
  detail: string;
}

export interface SystemStatusReport {
  checkedAt: string;
  environment: string;
  version: string;
  uptimeSeconds: number;
  overall: OverallStatus;
  services: ServiceReport[];
}

export interface SystemStatusDeps {
  now: () => Date;
  environment: string;
  version: string;
  uptimeSeconds: () => number;
  /** Runs `SELECT 1`; rejects when the database does not answer. */
  pingDatabase: () => Promise<unknown>;
  cacheState: () => 'disabled' | 'up' | 'down';
  kafkaState: () => KafkaState;
  /** Dead letters and consumer lag; null when there is no queue. Rejects when the broker cannot be asked. */
  queueBacklog?: () => Promise<{ deadLetters: number; lag: number } | null>;
  /**
   * The Kafka producer connects on first use, so it reads "down" until the first notification has been sent. When it
   * does, this tries to connect before the status is called an error.
   */
  connectKafka?: () => Promise<unknown>;
  emailConfigured: () => boolean;
  /** Active, approved ADMIN / SUPER_ADMIN accounts: the people told about a new registration. */
  countAlertAdministrators: () => Promise<number>;
  /** Extra mailboxes from APPROVAL_NOTIFY_EMAIL (a count: the addresses never leave the server). */
  alertMailboxes: () => number;
  razorpay: () => { keyId?: string | null; keySecret?: string | null };
  /** True when uploads go to an S3-compatible bucket instead of the server's disk. */
  cloudStorage: () => boolean;
  /** Time limit for every single check. */
  probeTimeoutMs: number;
}

type Outcome = Pick<ServiceReport, 'status' | 'detail'>;

interface Probe {
  key: string;
  label: string;
  /** What to show when the check itself blows up or times out. */
  failure: string;
  check: (deps: SystemStatusDeps) => Outcome | Promise<Outcome>;
}

/** From this many waiting events the consumer counts as not keeping up. */
const QUEUE_LAG_WARNING = 50;

const CHECK_FAILED = 'This check could not be completed just now. Try again in a minute; if it keeps failing, ask the technical team.';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The mailer sends when SendGrid has a key, or SMTP has a user and a password (see buildTransportOptions in utils/email). */
export const isEmailConfigured = (email: typeof config.email = config.email): boolean =>
  Boolean(email.sendgridApiKey || (email.smtp?.user && email.smtp?.pass));

let cachedVersion: string | undefined;
/** The server's package.json version ("unknown" when it cannot be read). */
export const appVersion = (): string => {
  if (cachedVersion) return cachedVersion;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version?: unknown };
    cachedVersion = typeof parsed.version === 'string' && parsed.version ? parsed.version : 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
};

/** Rejects when `fn` throws, rejects, or takes longer than `ms`. The timer never outlives the call. */
const within = async <T>(fn: () => T | Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const PROBES: Probe[] = [
  {
    key: 'database',
    label: 'Database',
    failure: 'The database is not answering. Members cannot sign in or use the site until it is back. Ask the technical team to check the database server.',
    check: async (deps) => {
      await deps.pingDatabase();
      return { status: 'ok', detail: 'The database is answering normally.' };
    },
  },
  {
    key: 'cache',
    label: 'Speed-up cache',
    failure: CHECK_FAILED,
    check: (deps) => {
      const state = deps.cacheState();
      if (state === 'disabled') {
        return { status: 'off', detail: 'Not set up. The site works without it; busy pages just load a little slower.' };
      }
      if (state === 'up') return { status: 'ok', detail: 'Connected. Busy pages are served from the cache.' };
      return {
        status: 'warning',
        detail: 'Set up but not answering right now. The site keeps working, only a little slower. Ask the technical team to check it if this lasts.',
      };
    },
  },
  {
    key: 'notifications',
    label: 'Notifications',
    failure: 'The notification queue cannot be reached. The website sends notifications directly instead, so nothing is lost for now. Ask the technical team to check the queue.',
    check: async (deps) => {
      let state = deps.kafkaState();
      if (state === 'disabled') {
        return {
          status: 'off',
          detail: 'Not set up. Notifications and registration e-mails are sent directly by the website, which works but is not queued if the site restarts.',
        };
      }
      if (state === 'down' && deps.connectKafka) {
        try {
          await within(deps.connectKafka, Math.max(1, Math.floor(deps.probeTimeoutMs / 2)));
        } catch {
          // still down: reported below
        }
        state = deps.kafkaState();
      }
      if (state === 'up') {
        return { status: 'ok', detail: 'The notification queue is connected. In-app notifications and registration e-mails go through it.' };
      }
      return {
        status: 'error',
        detail: 'The notification queue cannot be reached. The website sends notifications directly instead, so nothing is lost for now. Ask the technical team to check the queue.',
      };
    },
  },
  {
    key: 'queue',
    label: 'Notification backlog',
    failure: 'The notification backlog could not be read. Ask the technical team to check the queue.',
    check: async (deps) => {
      const backlog = deps.queueBacklog ? await deps.queueBacklog() : null;
      if (!backlog) return { status: 'off', detail: 'Not in use: there is no notification queue.' };
      if (backlog.deadLetters > 0) {
        return {
          status: 'warning',
          detail: `${plural(backlog.deadLetters, 'notification', 'notifications')} could not be delivered and ${backlog.deadLetters === 1 ? 'is' : 'are'} waiting in the dead-letter queue. Ask the technical team to look at them (docs/KAFKA.md, "dlq").`,
        };
      }
      if (backlog.lag >= QUEUE_LAG_WARNING) {
        return { status: 'warning', detail: `${backlog.lag} notifications are waiting to be processed and the queue is not catching up. Ask the technical team to check the consumer.` };
      }
      return { status: 'ok', detail: 'No notification is stuck or waiting.' };
    },
  },
  {
    key: 'email',
    label: 'E-mail',
    failure: CHECK_FAILED,
    check: (deps) =>
      deps.emailConfigured()
        ? { status: 'ok', detail: 'An e-mail service is connected. Applicants and administrators will receive registration e-mails.' }
        : {
            status: 'warning',
            detail:
              'No e-mail service is set up, so applicants will not receive e-mails about their registration and administrators will not be e-mailed about new registrations. Ask the technical team to add the e-mail settings.',
          },
  },
  {
    key: 'approvalAlerts',
    label: 'New-registration alerts',
    failure: 'Could not count the administrators who are told about new registrations just now. Try again in a minute.',
    check: async (deps) => {
      // The notification handler stops at MAX_ADMINS_NOTIFIED accounts, so never promise more than that
      const administrators = Math.min(Math.max(0, Number(await deps.countAlertAdministrators()) || 0), MAX_ADMINS_NOTIFIED);
      const mailboxes = Math.max(0, deps.alertMailboxes());
      const extra = mailboxes > 0 ? plural(mailboxes, 'extra mailbox', 'extra mailboxes') : '';

      if (administrators === 0) {
        return {
          status: 'warning',
          detail: `No active administrator account will be told about new registrations${extra ? ` (only ${extra} would be e-mailed)` : ''}. Make at least one person an administrator.`,
        };
      }
      const who = `${plural(administrators, 'administrator account', 'administrator accounts')}${extra ? ` and ${extra}` : ''}`;
      // The e-mail line has its own check: if that one is broken it must not also take this line down
      let mailReady = true;
      try {
        mailReady = deps.emailConfigured();
      } catch {
        // unknown: say nothing about e-mail copies
      }
      const mailNote = mailReady ? '' : ' E-mail copies are not sent until the e-mail service is set up; the in-app alert still appears.';
      return { status: 'ok', detail: `New registrations are announced to ${who}.${mailNote}` };
    },
  },
  {
    key: 'payments',
    label: 'Online payments',
    failure: CHECK_FAILED,
    check: (deps) => {
      const keys = deps.razorpay();
      const keyId = (keys.keyId ?? '').trim();
      const keySecret = (keys.keySecret ?? '').trim();

      if (!keyId && !keySecret) {
        return {
          status: 'off',
          detail: 'Online payments are switched off, so donations and membership payments cannot be taken. Ask the technical team to add the payment keys when you want to accept them.',
        };
      }
      if (!keyId || !keySecret) {
        return { status: 'warning', detail: 'Only part of the payment keys are set, so online payments will fail. Ask the technical team to check the payment settings.' };
      }
      if (keyId.startsWith('rzp_live_')) {
        return { status: 'ok', detail: 'Payments are live: donations and memberships are collected for real.' };
      }
      if (keyId.startsWith('rzp_test_')) {
        // Test keys are right while trying the site out and wrong once real donations are expected
        return deps.environment === 'production'
          ? { status: 'warning', detail: 'Payments are in test mode: no real money is collected. Switch to the live payment keys before accepting real donations.' }
          : { status: 'ok', detail: 'Payments are in test mode: no real money moves. That is right while trying the site out.' };
      }
      return { status: 'warning', detail: 'The payment keys do not look like Razorpay test or live keys. Ask the technical team to check the payment settings.' };
    },
  },
  {
    key: 'storage',
    label: 'File storage',
    failure: CHECK_FAILED,
    check: (deps) =>
      deps.cloudStorage()
        ? { status: 'ok', detail: 'Photos and files are saved in cloud storage.' }
        : { status: 'ok', detail: "Photos and files are saved on the server's own disk. Make sure that disk is backed up." },
  },
];

const evaluate = async (probe: Probe, deps: SystemStatusDeps): Promise<ServiceReport> => {
  try {
    const outcome = await within(() => probe.check(deps), deps.probeTimeoutMs);
    return { key: probe.key, label: probe.label, status: outcome.status, detail: outcome.detail };
  } catch (error) {
    // The cause goes to the log (with the request id); the administrator only sees a fixed sentence
    log.warn('A system status check failed', { service: probe.key, err: error });
    return { key: probe.key, label: probe.label, status: 'error', detail: probe.failure };
  }
};

const overallOf = (services: ServiceReport[]): OverallStatus => {
  if (services.some((s) => s.status === 'error')) return 'error';
  if (services.some((s) => s.status === 'warning')) return 'warning';
  return 'ok';
};

const safeUptime = (read: () => number): number => {
  try {
    const seconds = Math.floor(read());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    return 0;
  }
};

/** Runs every check at the same time and assembles the report. Never rejects because of a check. */
export async function buildSystemStatus(deps: SystemStatusDeps): Promise<SystemStatusReport> {
  const services = await Promise.all(PROBES.map((probe) => evaluate(probe, deps)));
  return {
    checkedAt: deps.now().toISOString(),
    environment: deps.environment,
    version: deps.version,
    uptimeSeconds: safeUptime(deps.uptimeSeconds),
    overall: overallOf(services),
    services,
  };
}

/** The real thing: reads the live configuration and connections. Built per call, so it always reflects the current state. */
export const defaultSystemStatusDeps = (): SystemStatusDeps => ({
  now: () => new Date(),
  environment: config.nodeEnv,
  version: appVersion(),
  uptimeSeconds: () => process.uptime(),
  pingDatabase: () => prisma.$queryRaw`SELECT 1`,
  cacheState: () => (redis ? (redis.status === 'ready' ? 'up' : 'down') : 'disabled'),
  kafkaState: () => kafkaStatus(),
  connectKafka: () => getProducer(),
  queueBacklog: async () => {
    const settings = readKafkaSettings();
    return settings.enabled ? readQueueBacklog(getKafka(settings), settings) : null;
  },
  emailConfigured: () => isEmailConfigured(config.email),
  countAlertAdministrators: () => prisma.user.count({ where: registrationAlertAdmins() }),
  alertMailboxes: () => sharedMailboxes().length,
  razorpay: () => ({ keyId: config.razorpay.keyId, keySecret: config.razorpay.keySecret }),
  cloudStorage: () => Boolean(config.aws.accessKeyId && config.aws.secretAccessKey),
  probeTimeoutMs: 5000,
});

export const getSystemStatus = (): Promise<SystemStatusReport> => buildSystemStatus(defaultSystemStatusDeps());
