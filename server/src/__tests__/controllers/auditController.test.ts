import { api, authAs, mockReqRes, prismaMock } from '../../../tests/helpers';
import { auditController } from '../../controllers/auditController';

describe('auditController (unit)', () => {
  it('getLogs parses query params and caps limit at 100', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    const { req, res, next } = mockReqRes({
      query: {
        userId: 'u1',
        entityType: 'USER',
        action: 'DELETE',
        entityId: ' e1 ',
        startDate: '2026-01-01',
        endDate: '2026-02-01',
        page: '2',
        limit: '500',
      },
    });
    await auditController.getLogs(req, res, next);
    const args = prismaMock.auditLog.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ userId: 'u1', entityType: 'USER', action: 'DELETE', entityId: 'e1' });
    expect(args.where.createdAt.gte).toEqual(new Date('2026-01-01'));
    expect(args.take).toBe(100);
    expect(args.skip).toBe(100);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, logs: [] }));
    expect(next).not.toHaveBeenCalled();
  });

  it('getLogs falls back to defaults on garbage paging', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    const { req, res, next } = mockReqRes({ query: { page: 'abc', limit: 'xyz', userId: '' } });
    await auditController.getLogs(req, res, next);
    const args = prismaMock.auditLog.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(args.where).toEqual({});
  });

  it('getLogs rejects invalid dates with 400', async () => {
    const { req, res, next } = mockReqRes({ query: { startDate: 'not-a-date' } });
    await auditController.getLogs(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('getLogs forwards database errors', async () => {
    prismaMock.auditLog.findMany.mockRejectedValue(new Error('db'));
    prismaMock.auditLog.count.mockResolvedValue(0);
    const { req, res, next } = mockReqRes();
    await auditController.getLogs(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('getEntityHistory returns logs, 400s on missing params and forwards errors', async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([{ id: 'l' }]);
    let ctx = mockReqRes({ params: { entityType: 'USER', entityId: 'u1' } });
    await auditController.getEntityHistory(ctx.req, ctx.res, ctx.next);
    expect(ctx.res.json).toHaveBeenCalledWith({ success: true, logs: [{ id: 'l' }] });

    ctx = mockReqRes({ params: { entityType: 'USER' } });
    await auditController.getEntityHistory(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));

    prismaMock.auditLog.findMany.mockRejectedValueOnce(new Error('db'));
    ctx = mockReqRes({ params: { entityType: 'USER', entityId: 'u1' } });
    await auditController.getEntityHistory(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('getRecentActivity clamps limit and forwards errors', async () => {
    prismaMock.auditLog.findMany.mockResolvedValueOnce([]);
    let ctx = mockReqRes({ query: { limit: '999' } });
    await auditController.getRecentActivity(ctx.req, ctx.res, ctx.next);
    expect(prismaMock.auditLog.findMany.mock.calls[0][0].take).toBe(50);
    expect(ctx.res.json).toHaveBeenCalledWith({ success: true, logs: [] });

    prismaMock.auditLog.findMany.mockRejectedValueOnce(new Error('db'));
    ctx = mockReqRes();
    await auditController.getRecentActivity(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).toHaveBeenCalledWith(expect.any(Error));
  });

  describe('cleanupOldLogs', () => {
    it('deletes with the requested retention and audits the cleanup', async () => {
      prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 4 });
      const { req, res, next } = mockReqRes({ body: { daysToKeep: '90' }, user: { id: 'super' }, ip: '9.9.9.9' });
      await auditController.cleanupOldLogs(req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Successfully deleted 4 old audit logs',
        deletedCount: 4,
      });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'super',
          action: 'DELETE',
          entityType: 'SYSTEM',
          newValues: { daysToKeep: 90, deletedCount: 4 },
        }),
      });
    });

    it('defaults to 365 days when not provided', async () => {
      prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 0 });
      const { req, res, next } = mockReqRes({ body: {} });
      await auditController.cleanupOldLogs(req, res, next);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deletedCount: 0 }));
      expect(next).not.toHaveBeenCalled();
    });

    it.each([[0], [-5], ['10'], ['abc'], [29]])('rejects daysToKeep=%p with 400 and deletes nothing', async (days) => {
      const { req, res, next } = mockReqRes({ body: { daysToKeep: days } });
      await auditController.cleanupOldLogs(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});

describe('audit routes', () => {
  it('GET /api/admin/audit is admin-only', async () => {
    const member = authAs('MEMBER');
    await api().get('/api/admin/audit').set('Authorization', member.header).expect(403);

    const admin = authAs('ADMIN');
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    const res = await api().get('/api/admin/audit?limit=5').set('Authorization', admin.header).expect(200);
    expect(res.body).toMatchObject({ success: true, logs: [], pagination: { limit: 5 } });
  });

  it('POST /api/admin/audit/cleanup is super-admin only and validates retention', async () => {
    const admin = authAs('ADMIN');
    await api().post('/api/admin/audit/cleanup').set('Authorization', admin.header).send({ daysToKeep: 90 }).expect(403);

    const superAdmin = authAs('SUPER_ADMIN');
    const bad = await api()
      .post('/api/admin/audit/cleanup')
      .set('Authorization', superAdmin.header)
      .send({ daysToKeep: 1 })
      .expect(400);
    expect(bad.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});
