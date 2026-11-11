import { api, authAs, getApp, mockReqRes, prismaMock } from '../../../tests/helpers';
import config from '../../config';
import { systemStatusController } from '../../controllers/systemStatusController';
import * as systemStatus from '../../services/systemStatusService';

describe('systemStatusController.get', () => {
  let spy: jest.SpyInstance | undefined;
  afterEach(() => spy?.mockRestore());

  it('wraps the report in the standard envelope', async () => {
    const report: systemStatus.SystemStatusReport = {
      checkedAt: '2026-11-09T10:00:00.000Z',
      environment: 'test',
      version: '1.0.0',
      uptimeSeconds: 5,
      overall: 'ok',
      services: [],
    };
    spy = jest.spyOn(systemStatus, 'getSystemStatus').mockResolvedValue(report);
    const { req, res, next } = mockReqRes();

    await systemStatusController.get(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ success: true, data: report });
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards an unexpected failure to the error handler', async () => {
    const failure = new Error('unexpected');
    spy = jest.spyOn(systemStatus, 'getSystemStatus').mockRejectedValue(failure);
    const { req, res, next } = mockReqRes();

    await systemStatusController.get(req, res, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/system-status', () => {
  beforeAll(() => {
    getApp();
  }, 120000);

  const original = { razorpay: { ...config.razorpay }, aws: { ...config.aws }, email: { ...config.email, smtp: { ...config.email.smtp } } };
  afterEach(() => {
    Object.assign(config.razorpay, original.razorpay);
    Object.assign(config.aws, original.aws);
    Object.assign(config.email, original.email, { smtp: { ...original.email.smtp } });
    delete process.env.APPROVAL_NOTIFY_EMAIL;
  });

  it('is admin-only', async () => {
    await api().get('/api/admin/system-status').expect(401);
    for (const role of ['MEMBER', 'CHAPTER_ADMIN'] as const) {
      const { header } = authAs(role);
      await api().get('/api/admin/system-status').set('Authorization', header).expect(403);
    }
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      const { header } = authAs(role);
      prismaMock.user.count.mockResolvedValue(1);
      await api().get('/api/admin/system-status').set('Authorization', header).expect(200);
    }
  });

  it('returns the documented shape: when it was checked, where it runs, how long it has run and one line per service', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(2);

    const res = await api().get('/api/admin/system-status').set('Authorization', header).expect(200);

    expect(res.body.success).toBe(true);
    const { data } = res.body;
    expect(Object.keys(data).sort()).toEqual(['checkedAt', 'environment', 'overall', 'services', 'uptimeSeconds', 'version']);
    expect(new Date(data.checkedAt).toISOString()).toBe(data.checkedAt);
    expect(data.environment).toBe(config.nodeEnv);
    expect(data.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isInteger(data.uptimeSeconds)).toBe(true);
    expect(['ok', 'warning', 'error']).toContain(data.overall);
    expect(data.services.map((s: { key: string }) => s.key)).toEqual(['database', 'cache', 'notifications', 'email', 'approvalAlerts', 'payments', 'storage']);
    for (const s of data.services) {
      expect(Object.keys(s).sort()).toEqual(['detail', 'key', 'label', 'status']);
    }
  });

  it('runs SELECT 1 against the database and counts the administrators who are told about registrations', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(3);

    const res = await api().get('/api/admin/system-status').set('Authorization', header).expect(200);

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.count).toHaveBeenCalledWith({
      where: { isActive: true, approvalStatus: 'APPROVED', userRole: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    });
    const alerts = res.body.data.services.find((s: { key: string }) => s.key === 'approvalAlerts');
    expect(alerts).toMatchObject({ status: 'ok' });
    expect(alerts.detail).toContain('3 administrator accounts');
  });

  it('counts the extra mailboxes of APPROVAL_NOTIFY_EMAIL without returning the addresses', async () => {
    process.env.APPROVAL_NOTIFY_EMAIL = 'alumni-office@aiem.test, Registrar@AIEM.test ,not-an-address';
    const { header } = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(1);

    const res = await api().get('/api/admin/system-status').set('Authorization', header).expect(200);

    const alerts = res.body.data.services.find((s: { key: string }) => s.key === 'approvalAlerts');
    expect(alerts.detail).toContain('2 extra mailboxes');
    expect(JSON.stringify(res.body)).not.toMatch(/alumni-office|registrar|aiem\.test/i);
  });

  it('still answers 200, with the database marked as an error and no driver details, when the database is down', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.$queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:5432 (user aiem_app)'));
    prismaMock.user.count.mockRejectedValue(new Error('connect ECONNREFUSED 10.1.2.3:5432 (user aiem_app)'));

    const res = await api().get('/api/admin/system-status').set('Authorization', header).expect(200);

    expect(res.body.data.overall).toBe('error');
    const byKey = Object.fromEntries(res.body.data.services.map((s: { key: string }) => [s.key, s]));
    expect(byKey.database.status).toBe('error');
    expect(byKey.approvalAlerts.status).toBe('error');
    expect(byKey.storage.status).toBe('ok');
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|5432|aiem_app|stack/i);
  });

  it('reports configuration without revealing any secret, key, host, user, bucket or address', async () => {
    Object.assign(config.razorpay, { keyId: 'rzp_live_SECRETKEYID9999', keySecret: 'razorpay-secret-ABC' });
    Object.assign(config.aws, { accessKeyId: 'AKIASECRETACCESS', secretAccessKey: 'aws-secret-XYZ', s3Bucket: 'college-private-bucket' });
    Object.assign(config.email, { sendgridApiKey: 'SG.sendgrid-secret' });
    Object.assign(config.email.smtp, { host: 'smtp.secret-host.example', user: 'smtp-user-secret', pass: 'smtp-pass-secret' });
    const { header } = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(1);

    const res = await api().get('/api/admin/system-status').set('Authorization', header).expect(200);

    const byKey = Object.fromEntries(res.body.data.services.map((s: { key: string }) => [s.key, s]));
    expect(byKey.email.status).toBe('ok');
    expect(byKey.payments).toMatchObject({ status: 'ok' });
    expect(byKey.payments.detail).toMatch(/live/i);
    expect(byKey.storage.detail).toMatch(/cloud/i);
    expect(JSON.stringify(res.body)).not.toMatch(
      /SECRETKEYID|razorpay-secret|AKIASECRET|aws-secret|college-private-bucket|sendgrid-secret|secret-host|smtp-user-secret|smtp-pass-secret/,
    );
  });

  it('shows test mode for test payment keys, and no e-mail service as a warning', async () => {
    Object.assign(config.razorpay, { keyId: 'rzp_test_ABCDEF', keySecret: 'secret' });
    Object.assign(config.email, { sendgridApiKey: undefined });
    Object.assign(config.email.smtp, { user: undefined, pass: undefined });
    const { header } = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(1);

    const res = await api().get('/api/admin/system-status').set('Authorization', header).expect(200);

    const byKey = Object.fromEntries(res.body.data.services.map((s: { key: string }) => [s.key, s]));
    expect(byKey.payments.detail).toMatch(/test mode/i);
    expect(byKey.email.status).toBe('warning');
    expect(res.body.data.overall).toBe('warning');
  });

  it('replaces the old developer-facing readiness endpoint', async () => {
    const { header } = authAs('ADMIN');
    const res = await api().get('/api/platform/readiness').set('Authorization', header);
    expect(res.status).toBe(404);
  });
});
