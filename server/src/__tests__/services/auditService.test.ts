import { prismaMock } from '../../../tests/helpers';
import {
  deleteOldAuditLogs,
  getAuditLogs,
  getEntityAuditHistory,
  getRecentAdminActivity,
  logAuditAction,
  MIN_AUDIT_RETENTION_DAYS,
} from '../../services/auditService';
import { AppError } from '../../middleware/errorHandler';

const DAY = 24 * 60 * 60 * 1000;

describe('logAuditAction', () => {
  it('writes the entry', async () => {
    prismaMock.auditLog.create.mockResolvedValue({ id: 'log-1' });
    const result = await logAuditAction({
      userId: 'u1',
      action: 'APPROVE',
      entityType: 'JOB',
      entityId: 'j1',
      oldValues: { status: 'PENDING' },
      newValues: { status: 'PUBLISHED' },
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
    });
    expect(result).toEqual({ id: 'log-1' });
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        action: 'APPROVE',
        entityType: 'JOB',
        entityId: 'j1',
        oldValues: { status: 'PENDING' },
        newValues: { status: 'PUBLISHED' },
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      },
    });
  });

  it('never throws when the database fails (async rejection)', async () => {
    prismaMock.auditLog.create.mockRejectedValue(new Error('db down'));
    await expect(logAuditAction({ action: 'DELETE', entityType: 'POST' })).resolves.toBeNull();
  });

  it('never throws when the client throws synchronously', async () => {
    prismaMock.auditLog.create.mockImplementation(() => {
      throw new Error('sync boom');
    });
    await expect(logAuditAction({ action: 'DELETE', entityType: 'POST' })).resolves.toBeNull();
  });

  it('ignores incomplete entries without throwing', async () => {
    await expect(logAuditAction(undefined as any)).resolves.toBeNull();
    await expect(logAuditAction({ entityType: 'POST' } as any)).resolves.toBeNull();
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('getAuditLogs', () => {
  it('applies every filter and paginates', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([{ id: 'l1' }]);
    prismaMock.auditLog.count.mockResolvedValue(120);
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-02-01');

    const result = await getAuditLogs({
      userId: 'u1',
      entityType: 'USER',
      action: 'ROLE_CHANGE',
      entityId: 'e1',
      startDate,
      endDate,
      page: 3,
      limit: 25,
    });

    const args = prismaMock.auditLog.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      userId: 'u1',
      entityType: 'USER',
      action: 'ROLE_CHANGE',
      entityId: 'e1',
      createdAt: { gte: startDate, lte: endDate },
    });
    expect(args.skip).toBe(50);
    expect(args.take).toBe(25);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(prismaMock.auditLog.count).toHaveBeenCalledWith({ where: args.where });
    expect(result).toEqual({ logs: [{ id: 'l1', user: null }], pagination: { page: 3, limit: 25, total: 120, totalPages: 5 } });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('attaches the acting user (id, name, email) to each entry with one lookup', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([
      { id: 'l1', userId: 'u1' },
      { id: 'l2', userId: 'u1' },
      { id: 'l3', userId: 'gone' },
      { id: 'l4', userId: null },
    ]);
    prismaMock.auditLog.count.mockResolvedValue(4);
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'Ada Admin', email: 'ada@aitd.test' }]);

    const result = await getAuditLogs({});

    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'gone'] } },
      select: { id: true, fullName: true, email: true },
    });
    const ada = { id: 'u1', fullName: 'Ada Admin', email: 'ada@aitd.test' };
    expect(result.logs).toEqual([
      { id: 'l1', userId: 'u1', user: ada },
      { id: 'l2', userId: 'u1', user: ada },
      { id: 'l3', userId: 'gone', user: null },
      { id: 'l4', userId: null, user: null },
    ]);
  });

  it('still returns entries when the actor lookup fails', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([{ id: 'l1', userId: 'u1' }]);
    prismaMock.auditLog.count.mockResolvedValue(1);
    prismaMock.user.findMany.mockRejectedValue(new Error('db hiccup'));

    const result = await getAuditLogs({});

    expect(result.logs).toEqual([{ id: 'l1', userId: 'u1', user: null }]);
  });

  it('defaults to page 1 / 50 with no filters', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    const result = await getAuditLogs({});
    const args = prismaMock.auditLog.findMany.mock.calls[0][0];
    expect(args.where).toEqual({});
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(result.pagination).toEqual({ page: 1, limit: 50, total: 0, totalPages: 0 });
  });

  it('sanitises NaN/negative/oversized paging and ignores invalid dates', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.auditLog.count.mockResolvedValue(0);
    await getAuditLogs({ page: NaN, limit: 10_000, startDate: new Date('nope') });
    const args = prismaMock.auditLog.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(100);
    expect(args.where.createdAt).toBeUndefined();

    await getAuditLogs({ page: -4, limit: 0, endDate: new Date('2026-01-01') });
    const args2 = prismaMock.auditLog.findMany.mock.calls[1][0];
    expect(args2.skip).toBe(0);
    expect(args2.take).toBe(1);
    expect(args2.where.createdAt).toEqual({ lte: new Date('2026-01-01') });
  });
});

describe('entity history and recent activity', () => {
  it('fetches the history of one entity', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    await getEntityAuditHistory('USER', 'u1');
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith({
      where: { entityType: 'USER', entityId: 'u1' },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  });

  it('returns privileged actions by real users, clamped to 1..50', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    await getRecentAdminActivity();
    const args = prismaMock.auditLog.findMany.mock.calls[0][0];
    expect(args.where.userId).toEqual({ not: null });
    expect(args.where.action.in).toEqual(expect.arrayContaining(['APPROVE', 'ROLE_CHANGE', 'DELETE']));
    expect(args.take).toBe(20);
    await getRecentAdminActivity(500);
    expect(prismaMock.auditLog.findMany.mock.calls[1][0].take).toBe(50);
    await getRecentAdminActivity(NaN);
    expect(prismaMock.auditLog.findMany.mock.calls[2][0].take).toBe(20);
  });
});

describe('deleteOldAuditLogs', () => {
  it('only deletes entries older than the retention window', async () => {
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 12 });
    const before = Date.now();
    const deleted = await deleteOldAuditLogs(90);
    expect(deleted).toBe(12);
    const cutoff: Date = prismaMock.auditLog.deleteMany.mock.calls[0][0].where.createdAt.lt;
    const ageDays = (before - cutoff.getTime()) / DAY;
    expect(ageDays).toBeGreaterThan(89.9);
    expect(ageDays).toBeLessThan(91.1);
  });

  it('defaults to a 365-day retention', async () => {
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    await deleteOldAuditLogs();
    const cutoff: Date = prismaMock.auditLog.deleteMany.mock.calls[0][0].where.createdAt.lt;
    expect(Math.round((Date.now() - cutoff.getTime()) / DAY)).toBeGreaterThanOrEqual(364);
  });

  it('accepts exactly the minimum', async () => {
    prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 0 });
    await expect(deleteOldAuditLogs(MIN_AUDIT_RETENTION_DAYS)).resolves.toBe(0);
  });

  it.each([[0], [-1], [29], [1.5], [NaN], [Infinity]])('refuses a retention of %p days', async (days) => {
    await expect(deleteOldAuditLogs(days)).rejects.toBeInstanceOf(AppError);
    await expect(deleteOldAuditLogs(days)).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
  });
});
