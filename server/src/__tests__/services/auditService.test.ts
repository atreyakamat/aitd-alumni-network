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
import { log } from '../../utils/logger';

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

  it('reports a failed write through the structured logger, with the identifying fields only', async () => {
    const error = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    try {
      const failure = new Error('db down');
      prismaMock.auditLog.create.mockRejectedValue(failure);
      await logAuditAction({ action: 'DELETE', entityType: 'POST', entityId: 'p1', oldValues: { email: 'a@b.test' } });
      expect(error).toHaveBeenCalledTimes(1);
      const [message, fields] = error.mock.calls[0];
      expect(message).toBe('Failed to create audit log');
      expect(fields).toEqual({ action: 'DELETE', entityType: 'POST', entityId: 'p1', err: failure });
    } finally {
      error.mockRestore();
    }
  });

  it('never writes the old/new values of an incomplete entry to the log', async () => {
    const error = jest.spyOn(log, 'error').mockImplementation(() => undefined);
    try {
      await logAuditAction({ entityType: 'POST', newValues: { email: 'a@b.test' } } as any);
      expect(error).toHaveBeenCalledWith('Refusing to write incomplete audit log entry', expect.any(Object));
      expect(JSON.stringify(error.mock.calls)).not.toContain('a@b.test');
    } finally {
      error.mockRestore();
    }
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
    expect(result).toEqual({ logs: [{ id: 'l1', user: null, entityLabel: null }], pagination: { page: 3, limit: 25, total: 120, totalPages: 5 } });
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
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'Ada Admin', email: 'ada@aiem.test' }]);

    const result = await getAuditLogs({});

    expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['u1', 'gone'] } },
      select: { id: true, fullName: true, email: true },
    });
    const ada = { id: 'u1', fullName: 'Ada Admin', email: 'ada@aiem.test' };
    expect(result.logs).toEqual([
      { id: 'l1', userId: 'u1', user: ada, entityLabel: null },
      { id: 'l2', userId: 'u1', user: ada, entityLabel: null },
      { id: 'l3', userId: 'gone', user: null, entityLabel: null },
      { id: 'l4', userId: null, user: null, entityLabel: null },
    ]);
  });

  it('still returns entries when the actor lookup fails', async () => {
    prismaMock.auditLog.findMany.mockResolvedValue([{ id: 'l1', userId: 'u1' }]);
    prismaMock.auditLog.count.mockResolvedValue(1);
    prismaMock.user.findMany.mockRejectedValue(new Error('db hiccup'));

    const result = await getAuditLogs({});

    expect(result.logs).toEqual([{ id: 'l1', userId: 'u1', user: null, entityLabel: null }]);
  });

  describe('entityLabel (a readable name for the person an entry is about)', () => {
    const ada = { id: 'admin-1', fullName: 'Ada Admin', email: 'ada@aiem.test' };
    const grace = { id: 'user-2', fullName: 'Grace Hopper', email: 'grace@aiem.test' };
    const alan = { id: 'user-3', fullName: 'Alan Turing', email: 'alan@aiem.test' };

    const arrange = (logs: unknown[], users: unknown[]) => {
      prismaMock.auditLog.findMany.mockResolvedValue(logs);
      prismaMock.auditLog.count.mockResolvedValue(logs.length);
      prismaMock.user.findMany.mockResolvedValue(users);
    };

    it('labels USER targets as "Full Name (email)"', async () => {
      arrange([{ id: 'l1', userId: 'admin-1', action: 'APPROVE', entityType: 'USER', entityId: 'user-2' }], [ada, grace]);

      const result = await getAuditLogs({});

      expect(result.logs[0].entityLabel).toBe('Grace Hopper (grace@aiem.test)');
      // the raw id is still there for anyone who needs it, and the acting administrator is resolved as before
      expect(result.logs[0]).toMatchObject({ entityType: 'USER', entityId: 'user-2', user: ada });
    });

    it('is null for a user that no longer exists', async () => {
      arrange([{ id: 'l1', userId: 'admin-1', action: 'DELETE', entityType: 'USER', entityId: 'deleted-user' }], [ada]);

      const result = await getAuditLogs({});

      expect(result.logs[0].entityLabel).toBeNull();
    });

    it('is null for other entity types, even when their id happens to match a user, and for entries without a target', async () => {
      arrange(
        [
          { id: 'l1', userId: 'admin-1', entityType: 'POST', entityId: 'user-2' },
          { id: 'l2', userId: 'admin-1', entityType: 'SYSTEM', entityId: 'audit-logs' },
          { id: 'l3', userId: 'admin-1', entityType: 'USER', entityId: null },
          { id: 'l4', userId: 'admin-1', entityType: 'USER' },
          { id: 'l5', userId: 'admin-1', entityType: 'USER', entityId: '' },
        ],
        [ada, grace],
      );

      const result = await getAuditLogs({});

      expect(result.logs.map((entry) => entry.entityLabel)).toEqual([null, null, null, null, null]);
    });

    it('resolves every row of the page with ONE query (targets and acting administrators together)', async () => {
      const entries = Array.from({ length: 100 }, (_, i) => ({
        id: `l${i}`,
        userId: 'admin-1',
        action: 'ACTIVATE',
        entityType: 'USER',
        entityId: i % 2 === 0 ? 'user-2' : 'user-3',
      }));
      arrange(entries, [ada, grace, alan]);

      const result = await getAuditLogs({ limit: 100 });

      expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
      const query = prismaMock.user.findMany.mock.calls[0][0];
      expect([...query.where.id.in].sort()).toEqual(['admin-1', 'user-2', 'user-3']); // each id once, not once per row
      expect(query.select).toEqual({ id: true, fullName: true, email: true }); // nothing beyond name and e-mail is read
      expect(result.logs).toHaveLength(100);
      expect(result.logs[0].entityLabel).toBe('Grace Hopper (grace@aiem.test)');
      expect(result.logs[1].entityLabel).toBe('Alan Turing (alan@aiem.test)');
      expect(result.logs[99].entityLabel).toBe('Alan Turing (alan@aiem.test)');
    });

    it('asks for the target of a USER entry that has no acting user (for example a system action)', async () => {
      arrange([{ id: 'l1', userId: null, entityType: 'USER', entityId: 'user-3' }], [alan]);

      const result = await getAuditLogs({});

      expect(prismaMock.user.findMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['user-3'] } });
      expect(result.logs[0]).toMatchObject({ user: null, entityLabel: 'Alan Turing (alan@aiem.test)' });
    });

    it('does not query users at all when no row needs one', async () => {
      arrange([{ id: 'l1', userId: null, entityType: 'SYSTEM', entityId: 'audit-logs' }], []);

      const result = await getAuditLogs({});

      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
      expect(result.logs).toEqual([{ id: 'l1', userId: null, entityType: 'SYSTEM', entityId: 'audit-logs', user: null, entityLabel: null }]);
    });

    it('falls back to whichever of name and e-mail exists', async () => {
      arrange(
        [
          { id: 'l1', userId: null, entityType: 'USER', entityId: 'no-name' },
          { id: 'l2', userId: null, entityType: 'USER', entityId: 'no-email' },
        ],
        [
          { id: 'no-name', fullName: '  ', email: 'anon@aiem.test' },
          { id: 'no-email', fullName: 'Only Name', email: '' },
        ],
      );

      const result = await getAuditLogs({});

      expect(result.logs.map((entry) => entry.entityLabel)).toEqual(['anon@aiem.test', 'Only Name']);
    });

    it('still returns the entries, with null labels, when the lookup fails', async () => {
      arrange([{ id: 'l1', userId: 'admin-1', entityType: 'USER', entityId: 'user-2' }], []);
      prismaMock.user.findMany.mockRejectedValue(new Error('db hiccup'));

      const result = await getAuditLogs({});

      expect(result.logs).toEqual([{ id: 'l1', userId: 'admin-1', entityType: 'USER', entityId: 'user-2', user: null, entityLabel: null }]);
    });

    it('never puts more than the name and e-mail of a user into the label', async () => {
      // even if the query result carried more fields (it cannot: see the select above), only name and e-mail are used
      arrange(
        [{ id: 'l1', userId: null, entityType: 'USER', entityId: 'user-2' }],
        [{ ...grace, passwordHash: 'secret-hash', phoneNumber: '+91 99999 99999' }],
      );

      const result = await getAuditLogs({});

      expect(result.logs[0].entityLabel).toBe('Grace Hopper (grace@aiem.test)');
      expect(JSON.stringify(result.logs[0].entityLabel)).not.toMatch(/secret-hash|99999/);
    });
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
