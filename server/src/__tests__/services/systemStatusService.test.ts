import {
  appVersion,
  buildSystemStatus,
  isEmailConfigured,
  type ServiceStatus,
  type SystemStatusDeps,
  type SystemStatusReport,
} from '../../services/systemStatusService';
import { buildTransportOptions } from '../../utils/email';

/** Everything healthy and configured. Each test overrides only what it is about. */
const makeDeps = (overrides: Partial<SystemStatusDeps> = {}): SystemStatusDeps => ({
  now: () => new Date('2026-11-09T10:00:00.000Z'),
  environment: 'production',
  version: '1.2.3',
  uptimeSeconds: () => 3725.8,
  pingDatabase: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  cacheState: () => 'up',
  kafkaState: () => 'up',
  emailConfigured: () => true,
  countAlertAdministrators: jest.fn().mockResolvedValue(2),
  alertMailboxes: () => 1,
  razorpay: () => ({ keyId: 'rzp_live_ABCDEF123456', keySecret: 'live-secret-value' }),
  cloudStorage: () => true,
  probeTimeoutMs: 1000,
  ...overrides,
});

const service = (report: SystemStatusReport, key: string) => {
  const found = report.services.find((s) => s.key === key);
  if (!found) throw new Error(`no "${key}" service in the report`);
  return found;
};

describe('queue backlog (dead letters and consumer lag)', () => {
  const report = (backlog: SystemStatusDeps['queueBacklog']) => buildSystemStatus(makeDeps({ queueBacklog: backlog })).then((r) => service(r, 'queue'));

  it('is off when there is no notification queue', async () => {
    expect((await report(undefined)).status).toBe('off');
    expect((await report(async () => null)).status).toBe('off');
  });

  it('is ok when nothing is stuck and nothing waits', async () => {
    const queue = await report(async () => ({ deadLetters: 0, lag: 3 }));
    expect(queue.status).toBe('ok');
  });

  it('warns about dead letters, in words an administrator can act on', async () => {
    const queue = await report(async () => ({ deadLetters: 2, lag: 0 }));
    expect(queue.status).toBe('warning');
    expect(queue.detail).toMatch(/2 notifications could not be delivered/);
    expect((await report(async () => ({ deadLetters: 1, lag: 0 }))).detail).toMatch(/1 notification could not be delivered/);
  });

  it('warns when the consumer is not catching up', async () => {
    const queue = await report(async () => ({ deadLetters: 0, lag: 120 }));
    expect(queue.status).toBe('warning');
    expect(queue.detail).toMatch(/120/);
  });

  it('turns an unreachable broker into a fixed sentence, never the cause', async () => {
    const queue = await report(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:9092');
    });
    expect(queue.status).toBe('error');
    expect(queue.detail).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/);
  });
});

describe('buildSystemStatus', () => {
  describe('report shape', () => {
    it('describes a healthy system with the documented fields, in a stable order', async () => {
      const report = await buildSystemStatus(makeDeps());

      expect(report).toEqual({
        checkedAt: '2026-11-09T10:00:00.000Z',
        environment: 'production',
        version: '1.2.3',
        uptimeSeconds: 3725,
        overall: 'ok',
        services: expect.any(Array),
      });
      expect(report.services.map((s) => s.key)).toEqual(['database', 'cache', 'notifications', 'queue', 'email', 'approvalAlerts', 'payments', 'storage']);
      for (const s of report.services) {
        expect(Object.keys(s).sort()).toEqual(['detail', 'key', 'label', 'status']);
        expect(s.label.trim()).not.toBe('');
        expect(s.detail.trim()).not.toBe('');
        expect(['ok', 'warning', 'error', 'off']).toContain(s.status);
      }
    });

    it('never says "AITD" (the product is AIEM Connect)', async () => {
      const report = await buildSystemStatus(makeDeps({ kafkaState: () => 'disabled', cacheState: () => 'disabled', emailConfigured: () => false }));
      expect(JSON.stringify(report)).not.toMatch(/aitd/i);
    });

    it('reports whole seconds of uptime, never a negative or non-finite number', async () => {
      expect((await buildSystemStatus(makeDeps({ uptimeSeconds: () => 59.99 }))).uptimeSeconds).toBe(59);
      expect((await buildSystemStatus(makeDeps({ uptimeSeconds: () => -5 }))).uptimeSeconds).toBe(0);
      expect((await buildSystemStatus(makeDeps({ uptimeSeconds: () => NaN }))).uptimeSeconds).toBe(0);
    });
  });

  describe('overall', () => {
    const withStatuses = async (patch: Partial<SystemStatusDeps>): Promise<ServiceStatus> => (await buildSystemStatus(makeDeps(patch))).overall;

    it('is ok when every service is ok or switched off', async () => {
      expect(await withStatuses({ cacheState: () => 'disabled', kafkaState: () => 'disabled', razorpay: () => ({ keyId: '', keySecret: '' }) })).toBe('ok');
    });

    it('is warning when a service has a warning and none has an error', async () => {
      expect(await withStatuses({ emailConfigured: () => false })).toBe('warning');
    });

    it('is error when any service has an error, even next to warnings', async () => {
      const deps = makeDeps({ emailConfigured: () => false, pingDatabase: jest.fn().mockRejectedValue(new Error('down')) });
      expect((await buildSystemStatus(deps)).overall).toBe('error');
    });
  });

  describe('database', () => {
    it('is ok when SELECT 1 answers', async () => {
      const deps = makeDeps();
      const report = await buildSystemStatus(deps);
      expect(deps.pingDatabase).toHaveBeenCalledTimes(1);
      expect(service(report, 'database')).toMatchObject({ status: 'ok' });
    });

    it('is an error, without the driver message, when the query fails, and the other services are still reported', async () => {
      const deps = makeDeps({ pingDatabase: jest.fn().mockRejectedValue(new Error('password authentication failed for user "aiem_app" at 10.0.0.12:5432')) });
      const report = await buildSystemStatus(deps);

      const database = service(report, 'database');
      expect(database.status).toBe('error');
      expect(JSON.stringify(report)).not.toMatch(/password|aiem_app|10\.0\.0\.12|5432|Error:/);
      expect(report.services).toHaveLength(8);
      expect(service(report, 'storage').status).toBe('ok');
      expect(report.overall).toBe('error');
    });

    it('is an error when the database does not answer in time (the page must not hang)', async () => {
      const deps = makeDeps({ pingDatabase: () => new Promise(() => undefined), probeTimeoutMs: 25 });
      const started = Date.now();
      const report = await buildSystemStatus(deps);

      expect(Date.now() - started).toBeLessThan(2000);
      expect(service(report, 'database').status).toBe('error');
    });
  });

  describe('cache (Redis)', () => {
    it('is off when no cache is configured, and says that the site works without it', async () => {
      const cache = service(await buildSystemStatus(makeDeps({ cacheState: () => 'disabled' })), 'cache');
      expect(cache.status).toBe('off');
      expect(cache.detail).toMatch(/works without/i);
    });

    it('is ok when connected', async () => {
      expect(service(await buildSystemStatus(makeDeps({ cacheState: () => 'up' })), 'cache').status).toBe('ok');
    });

    it('is only a warning when it is configured but not answering (the site keeps working without it)', async () => {
      const cache = service(await buildSystemStatus(makeDeps({ cacheState: () => 'down' })), 'cache');
      expect(cache.status).toBe('warning');
    });
  });

  describe('notifications (Kafka)', () => {
    it('is off when no broker is configured and does not try to connect', async () => {
      const connectKafka = jest.fn();
      const notifications = service(await buildSystemStatus(makeDeps({ kafkaState: () => 'disabled', connectKafka })), 'notifications');
      expect(notifications.status).toBe('off');
      expect(connectKafka).not.toHaveBeenCalled();
    });

    it('is ok when the queue is connected, without reconnecting', async () => {
      const connectKafka = jest.fn();
      const notifications = service(await buildSystemStatus(makeDeps({ kafkaState: () => 'up', connectKafka })), 'notifications');
      expect(notifications.status).toBe('ok');
      expect(connectKafka).not.toHaveBeenCalled();
    });

    it('is an error when the queue is down and cannot be reached', async () => {
      const connectKafka = jest.fn().mockRejectedValue(new Error('ECONNREFUSED kafka-1.internal:9092'));
      const report = await buildSystemStatus(makeDeps({ kafkaState: () => 'down', connectKafka }));

      expect(service(report, 'notifications').status).toBe('error');
      expect(JSON.stringify(report)).not.toMatch(/ECONNREFUSED|kafka-1|9092/);
    });

    it('is an error without a connect attempt when the helper reports down and there is nothing to try', async () => {
      expect(service(await buildSystemStatus(makeDeps({ kafkaState: () => 'down' })), 'notifications').status).toBe('error');
    });

    it('is ok when the producer was only not connected yet (it connects on first use) and now connects', async () => {
      let state: 'down' | 'up' = 'down';
      const connectKafka = jest.fn().mockImplementation(async () => {
        state = 'up';
      });
      const notifications = service(await buildSystemStatus(makeDeps({ kafkaState: () => state, connectKafka })), 'notifications');
      expect(connectKafka).toHaveBeenCalledTimes(1);
      expect(notifications.status).toBe('ok');
    });

    it('is an error, quickly, when the connection attempt hangs', async () => {
      const report = await buildSystemStatus(makeDeps({ kafkaState: () => 'down', connectKafka: () => new Promise(() => undefined), probeTimeoutMs: 25 }));
      expect(service(report, 'notifications').status).toBe('error');
    });
  });

  describe('email', () => {
    it('is ok when a mail service is configured', async () => {
      expect(service(await buildSystemStatus(makeDeps({ emailConfigured: () => true })), 'email').status).toBe('ok');
    });

    it('warns, in plain words, that registration e-mails will not be sent when none is configured', async () => {
      const email = service(await buildSystemStatus(makeDeps({ emailConfigured: () => false })), 'email');
      expect(email.status).toBe('warning');
      expect(email.detail).toMatch(/applicants/i);
      expect(email.detail).toMatch(/administrators/i);
    });
  });

  describe('approval alerts', () => {
    it('counts the administrator accounts and the extra mailboxes, nothing else', async () => {
      const alerts = service(await buildSystemStatus(makeDeps({ countAlertAdministrators: jest.fn().mockResolvedValue(2), alertMailboxes: () => 1 })), 'approvalAlerts');
      expect(alerts.status).toBe('ok');
      expect(alerts.detail).toContain('2 administrator accounts');
      expect(alerts.detail).toContain('1 extra mailbox');
      expect(alerts.detail).not.toMatch(/@/);
    });

    it('uses the singular for one account and leaves out mailboxes when there are none', async () => {
      const alerts = service(await buildSystemStatus(makeDeps({ countAlertAdministrators: jest.fn().mockResolvedValue(1), alertMailboxes: () => 0 })), 'approvalAlerts');
      expect(alerts.status).toBe('ok');
      expect(alerts.detail).toContain('1 administrator account');
      expect(alerts.detail).not.toContain('1 administrator accounts');
      expect(alerts.detail).not.toMatch(/mailbox/i);
    });

    it('says "mailboxes" for several extra addresses', async () => {
      const alerts = service(await buildSystemStatus(makeDeps({ alertMailboxes: () => 3 })), 'approvalAlerts');
      expect(alerts.detail).toContain('3 extra mailboxes');
    });

    it('warns when there is no administrator to tell, even when extra mailboxes exist', async () => {
      const none = service(await buildSystemStatus(makeDeps({ countAlertAdministrators: jest.fn().mockResolvedValue(0), alertMailboxes: () => 0 })), 'approvalAlerts');
      expect(none.status).toBe('warning');
      expect(none.detail).toMatch(/administrator/i);

      const onlyMailbox = service(await buildSystemStatus(makeDeps({ countAlertAdministrators: jest.fn().mockResolvedValue(0), alertMailboxes: () => 2 })), 'approvalAlerts');
      expect(onlyMailbox.status).toBe('warning');
      expect(onlyMailbox.detail).toContain('2 extra mailboxes');
    });

    it('does not claim to alert more administrators than the notification handler will (it stops at 200)', async () => {
      const alerts = service(await buildSystemStatus(makeDeps({ countAlertAdministrators: jest.fn().mockResolvedValue(500) })), 'approvalAlerts');
      expect(alerts.detail).toContain('200 administrator accounts');
    });

    it('mentions that e-mail copies need the mail service when none is configured', async () => {
      const alerts = service(await buildSystemStatus(makeDeps({ emailConfigured: () => false })), 'approvalAlerts');
      expect(alerts.status).toBe('ok');
      expect(alerts.detail).toMatch(/e-mail/i);
    });

    it('degrades only this service when the count fails', async () => {
      const report = await buildSystemStatus(makeDeps({ countAlertAdministrators: jest.fn().mockRejectedValue(new Error('relation "User" does not exist')) }));
      expect(service(report, 'approvalAlerts').status).toBe('error');
      expect(JSON.stringify(report)).not.toMatch(/relation|does not exist/);
      expect(service(report, 'database').status).toBe('ok');
    });
  });

  describe('payments (Razorpay)', () => {
    const payments = async (keyId: string, keySecret: string, environment = 'production') =>
      service(await buildSystemStatus(makeDeps({ razorpay: () => ({ keyId, keySecret }), environment })), 'payments');

    it('is off when no keys are set', async () => {
      const result = await payments('', '');
      expect(result.status).toBe('off');
      expect(result.detail).toMatch(/donations/i);
    });

    it('is ok and says "live" for live keys', async () => {
      const result = await payments('rzp_live_ABCDEF123456', 'secret');
      expect(result.status).toBe('ok');
      expect(result.detail).toMatch(/live/i);
      expect(result.detail).not.toMatch(/test mode/i);
    });

    it('says "test mode" for test keys, and warns about it only where real money is expected (production)', async () => {
      const production = await payments('rzp_test_ABCDEF123456', 'secret', 'production');
      expect(production.status).toBe('warning');
      expect(production.detail).toMatch(/test mode/i);

      const development = await payments('rzp_test_ABCDEF123456', 'secret', 'development');
      expect(development.status).toBe('ok');
      expect(development.detail).toMatch(/test mode/i);
    });

    it('warns when only one of the two keys is set, or the key id is not a recognisable Razorpay key', async () => {
      expect((await payments('rzp_live_ABCDEF123456', '')).status).toBe('warning');
      expect((await payments('', 'secret')).status).toBe('warning');
      expect((await payments('something-else', 'secret')).status).toBe('warning');
    });

    it('never returns the keys', async () => {
      for (const [id, secret] of [
        ['rzp_live_ABCDEF123456', 'live-secret-value'],
        ['rzp_test_ABCDEF123456', 'test-secret-value'],
        ['weird_key_id_987', 'odd-secret-value'],
      ]) {
        const text = JSON.stringify(await payments(id, secret));
        expect(text).not.toContain(id);
        expect(text).not.toContain(secret);
        expect(text).not.toMatch(/ABCDEF123456|987/);
      }
    });
  });

  describe('storage', () => {
    it('says files go to cloud storage when a bucket is configured', async () => {
      const storage = service(await buildSystemStatus(makeDeps({ cloudStorage: () => true })), 'storage');
      expect(storage.status).toBe('ok');
      expect(storage.detail).toMatch(/cloud/i);
    });

    it("says files stay on the server's own disk otherwise, and reminds about backups", async () => {
      const storage = service(await buildSystemStatus(makeDeps({ cloudStorage: () => false })), 'storage');
      expect(storage.status).toBe('ok');
      expect(storage.detail).toMatch(/disk/i);
      expect(storage.detail).toMatch(/back/i);
    });
  });

  describe('a failing probe never fails the report', () => {
    it('turns a throwing synchronous check into an error for that service only, without leaking the exception', async () => {
      const boom = () => {
        throw new Error('secret stack detail at /srv/app/node_modules/x.js:10');
      };
      const report = await buildSystemStatus(makeDeps({ emailConfigured: boom, cacheState: boom, razorpay: boom, cloudStorage: boom, kafkaState: boom }));

      for (const key of ['email', 'cache', 'payments', 'storage', 'notifications']) {
        expect(service(report, key).status).toBe('error');
      }
      expect(service(report, 'database').status).toBe('ok');
      expect(service(report, 'approvalAlerts').status).toBe('ok');
      expect(report.overall).toBe('error');
      expect(JSON.stringify(report)).not.toMatch(/secret stack|node_modules|\/srv\/app/);
    });

    it('survives an uptime reader that throws by falling back to zero', async () => {
      const report = await buildSystemStatus(
        makeDeps({
          uptimeSeconds: () => {
            throw new Error('no clock');
          },
        }),
      );
      expect(report.uptimeSeconds).toBe(0);
    });
  });
});

describe('isEmailConfigured', () => {
  const smtp = (user?: string, pass?: string) => ({ host: 'smtp.example.test', port: 587, user, pass });

  it('is true for a SendGrid key or for SMTP login details, false otherwise', () => {
    expect(isEmailConfigured({ from: 'a@b.c', smtp: smtp(), sendgridApiKey: 'SG.key' })).toBe(true);
    expect(isEmailConfigured({ from: 'a@b.c', smtp: smtp('user', 'pass'), sendgridApiKey: undefined })).toBe(true);
    expect(isEmailConfigured({ from: 'a@b.c', smtp: smtp('user', undefined), sendgridApiKey: undefined })).toBe(false);
    expect(isEmailConfigured({ from: 'a@b.c', smtp: smtp(), sendgridApiKey: '' })).toBe(false);
  });

  it('agrees with the rule the mailer itself uses to decide whether it can send', () => {
    // utils/email is replaced by jest.fn doubles in unit tests: compare with the real one
    const realBuildTransportOptions = (jest.requireActual('../../utils/email') as { buildTransportOptions: typeof buildTransportOptions }).buildTransportOptions;
    const cases = [
      { from: 'a@b.c', smtp: smtp(), sendgridApiKey: undefined },
      { from: 'a@b.c', smtp: smtp(), sendgridApiKey: 'SG.key' },
      { from: 'a@b.c', smtp: smtp('user', 'pass'), sendgridApiKey: undefined },
      { from: 'a@b.c', smtp: smtp('user'), sendgridApiKey: undefined },
      { from: 'a@b.c', smtp: smtp(undefined, 'pass'), sendgridApiKey: '' },
    ];
    for (const email of cases) {
      expect(isEmailConfigured(email)).toBe(realBuildTransportOptions(email) !== null);
    }
  });
});

describe('appVersion', () => {
  it("reads the server's package version", () => {
    expect(appVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
