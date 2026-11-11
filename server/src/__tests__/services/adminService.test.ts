import { adminService, DEFAULT_EXPORT_MAX_ROWS, EXPORT_BATCH_SIZE } from '../../services/adminService';
import * as socketUtil from '../../utils/socket';
import { prismaMock } from '../../../tests/helpers';

const actor = (userRole: any, id = 'actor') => ({ id, userRole });
const target = (userRole: any, extra: Record<string, unknown> = {}) => ({
  id: 'target',
  email: 't@aiem.test',
  fullName: 'Target',
  userRole,
  isActive: true,
  ...extra,
});

describe('adminService', () => {
  describe('listUsers', () => {
    it('paginates and applies search/role/status filters', async () => {
      prismaMock.user.findMany.mockResolvedValue([target('MEMBER')]);
      prismaMock.user.count.mockResolvedValue(41);

      const result = await adminService.listUsers({
        search: 'ann',
        role: 'ADMIN',
        isActive: 'false',
        batchYear: '2019',
        page: 2,
        limit: 20,
      });

      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(args.where.userRole).toBe('ADMIN');
      expect(args.where.isActive).toBe(false);
      expect(args.where.batchYear).toBe(2019);
      expect(args.where.OR).toEqual([
        { fullName: { contains: 'ann', mode: 'insensitive' } },
        { email: { contains: 'ann', mode: 'insensitive' } },
      ]);
      expect(args.select.passwordHash).toBeUndefined();
      expect(result.pagination).toMatchObject({ page: 2, limit: 20, total: 41, totalPages: 3 });
    });

    it('tells the administrator whether each person is a member, waiting for approval, or rejected', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      prismaMock.user.count.mockResolvedValue(0);
      await adminService.listUsers({});
      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.select.approvalStatus).toBe(true);
      expect(args.select.passwordHash).toBeUndefined();
    });

    it('ignores unknown roles and caps the page size', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      prismaMock.user.count.mockResolvedValue(0);
      await adminService.listUsers({ role: 'ROOT', limit: 5000 });
      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.where.userRole).toBeUndefined();
      expect(args.take).toBe(100);
    });
  });

  describe('updateUserRole', () => {
    it('lets a super admin promote a member to admin and audits it', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('MEMBER'));
      prismaMock.user.update.mockResolvedValue(target('ADMIN'));

      const result = await adminService.updateUserRole(actor('SUPER_ADMIN'), 'target', 'ADMIN');

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'target' }, data: { userRole: 'ADMIN' } })
      );
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'actor',
          action: 'ROLE_CHANGE',
          entityType: 'USER',
          entityId: 'target',
          oldValues: { userRole: 'MEMBER' },
          newValues: { userRole: 'ADMIN' },
        }),
      });
      expect(result.userRole).toBe('ADMIN');
    });

    it('forbids an admin from creating another admin', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('MEMBER'));
      await expect(adminService.updateUserRole(actor('ADMIN'), 'target', 'ADMIN')).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('forbids an admin from demoting a peer admin', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('ADMIN'));
      await expect(adminService.updateUserRole(actor('ADMIN'), 'target', 'MEMBER')).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('lets an admin appoint a chapter admin', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('MEMBER'));
      prismaMock.user.update.mockResolvedValue(target('CHAPTER_ADMIN'));
      await expect(adminService.updateUserRole(actor('ADMIN'), 'target', 'CHAPTER_ADMIN')).resolves.toMatchObject({
        userRole: 'CHAPTER_ADMIN',
      });
    });

    it('forbids changing your own role', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('SUPER_ADMIN', { id: 'actor' }));
      await expect(adminService.updateUserRole(actor('SUPER_ADMIN'), 'actor', 'MEMBER')).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects an invalid role with 400', async () => {
      await expect(adminService.updateUserRole(actor('SUPER_ADMIN'), 'target', 'ROOT' as any)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('returns 404 for an unknown user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(adminService.updateUserRole(actor('SUPER_ADMIN'), 'nope', 'MEMBER')).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('is a no-op (no audit) when the role is unchanged', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('MEMBER'));
      await adminService.updateUserRole(actor('SUPER_ADMIN'), 'target', 'MEMBER');
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('updateUserStatus', () => {
    it('deactivates a member, revokes their sessions and access tokens and audits it', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('MEMBER'));
      prismaMock.user.update.mockResolvedValue(target('MEMBER', { isActive: false }));
      const disconnect = jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);

      await adminService.updateUserStatus(actor('ADMIN'), 'target', false, 'spam');
      expect(disconnect).toHaveBeenCalledWith('target');

      // tokenVersion bump: access tokens issued before deactivation stay dead even after reactivation
      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false, tokenVersion: { increment: 1 } } })
      );
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'target' } });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'DEACTIVATE', entityId: 'target', newValues: { isActive: false, reason: 'spam' } }),
      });
    });

    it('reactivates without touching sessions', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('MEMBER', { isActive: false }));
      prismaMock.user.update.mockResolvedValue(target('MEMBER'));
      const disconnect = jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);
      disconnect.mockClear();
      await adminService.updateUserStatus(actor('ADMIN'), 'target', true);
      expect(disconnect).not.toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: true } }));
      expect(prismaMock.refreshToken.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'ACTIVATE' }),
      });
    });

    it('forbids an admin from deactivating a super admin', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('SUPER_ADMIN'));
      await expect(adminService.updateUserStatus(actor('ADMIN'), 'target', false)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('forbids deactivating yourself', async () => {
      prismaMock.user.findUnique.mockResolvedValue(target('SUPER_ADMIN', { id: 'actor' }));
      await expect(adminService.updateUserStatus(actor('SUPER_ADMIN'), 'actor', false)).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects a non-boolean status with 400', async () => {
      await expect(adminService.updateUserStatus(actor('ADMIN'), 'target', 'no' as any)).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  describe('getPendingJobs', () => {
    it('lists jobs awaiting review oldest first', async () => {
      prismaMock.jobOpportunity.findMany.mockResolvedValue([{ id: 'j1' }]);
      prismaMock.jobOpportunity.count.mockResolvedValue(1);
      const result = await adminService.getPendingJobs(1, 10);
      const args = prismaMock.jobOpportunity.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: 'PENDING_REVIEW' });
      expect(args.orderBy).toEqual({ createdAt: 'asc' });
      expect(result.data).toEqual([{ id: 'j1' }]);
    });
  });

  describe('getMentorshipOverview', () => {
    it('summarises the mentorship lifecycle', async () => {
      prismaMock.mentorProfile.count.mockResolvedValueOnce(12).mockResolvedValueOnce(9);
      prismaMock.mentorshipRequest.groupBy.mockResolvedValue([
        { status: 'PENDING', _count: { _all: 3 } },
        { status: 'ACCEPTED', _count: { _all: 5 } },
        { status: 'COMPLETED', _count: { _all: 2 } },
      ]);
      prismaMock.mentorshipSession.count.mockResolvedValueOnce(20).mockResolvedValueOnce(14);

      const result = await adminService.getMentorshipOverview();

      expect(result).toEqual({
        mentors: { total: 12, active: 9 },
        requests: { PENDING: 3, ACCEPTED: 5, COMPLETED: 2, total: 10 },
        sessions: { total: 20, completed: 14, completionRate: 70 },
      });
    });

    it('reports a 0% completion rate when there are no sessions', async () => {
      prismaMock.mentorProfile.count.mockResolvedValue(0);
      prismaMock.mentorshipRequest.groupBy.mockResolvedValue([]);
      prismaMock.mentorshipSession.count.mockResolvedValue(0);
      const result = await adminService.getMentorshipOverview();
      expect(result.sessions.completionRate).toBe(0);
      expect(result.requests.total).toBe(0);
    });
  });

  describe('exportEntity', () => {
    const collect = async (chunks: AsyncIterable<string>) => {
      let text = '';
      for await (const chunk of chunks) text += chunk;
      return text;
    };
    const run = async (entity: string, limits?: { batchSize?: number; maxRows?: number }) => {
      const exported = await adminService.exportEntity(actor('ADMIN'), entity, {}, limits);
      return { ...exported, csv: await collect(exported.chunks) };
    };
    const lastAudit = () => {
      const calls = prismaMock.auditLog.create.mock.calls;
      return calls[calls.length - 1][0].data;
    };

    /** A table of `size` users, newest first, served the way Prisma would serve the keyset query the service sends. */
    const arrangeUsers = (size: number) => {
      const all = Array.from({ length: size }, (_, i) => ({
        id: `u${String(i).padStart(4, '0')}`,
        fullName: `User ${i}`,
        email: `u${i}@x.io`,
        batchYear: 2019,
        department: 'CSE',
        userRole: 'MEMBER',
        isActive: true,
        createdAt: new Date(Date.UTC(2026, 0, 1) - i * 1000),
      }));
      prismaMock.user.count.mockResolvedValue(size);
      prismaMock.user.findMany.mockImplementation(async (args: any) => {
        // the service continues after the last row it wrote: (createdAt, id) strictly before that row
        let start = 0;
        if (args.where?.OR) {
          const [byDate, byId] = args.where.OR;
          const lastAt: Date = byDate.createdAt.lt;
          const lastId: string = byId.id.lt;
          start = all.findIndex((u) => u.id === lastId) + 1;
          expect(byId.createdAt).toEqual(lastAt);
          expect(all[start - 1].createdAt).toEqual(lastAt);
        }
        return all.slice(start, start + args.take);
      });
      return all;
    };

    it('exports users as CSV without credentials and audits the export', async () => {
      prismaMock.user.count.mockResolvedValue(1);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', fullName: 'Ann', email: 'ann@x.io', batchYear: 2019, department: 'CSE', userRole: 'MEMBER', isActive: true, createdAt: new Date('2026-01-01T00:00:00Z') },
      ]);

      const { filename, csv, mayBeTruncated } = await run('users');

      expect(filename).toMatch(/^users-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(csv).toBe(
        'ID,Name,Email,Batch,Department,Role,Active,Joined\r\nu1,Ann,ann@x.io,2019,CSE,MEMBER,true,2026-01-01T00:00:00.000Z'
      );
      expect(csv).not.toMatch(/password/i);
      expect(mayBeTruncated).toBe(false);
      expect(prismaMock.user.findMany.mock.calls[0][0].select.passwordHash).toBeUndefined();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'EXPORT_DATA', entityType: 'SYSTEM', newValues: { entity: 'users', rows: 1, truncated: false } }),
      });
    });

    it.each(['transactions', 'donations', 'jobs', 'events'])('supports %s', async (entity) => {
      const model = { transactions: 'transaction', donations: 'donation', jobs: 'jobOpportunity', events: 'event' }[entity]!;
      prismaMock[model].count.mockResolvedValue(0);
      prismaMock[model].findMany.mockResolvedValue([]);
      const { csv } = await run(entity);
      expect(csv.split('\r\n')).toHaveLength(1);
    });

    it('never reads a table without a row limit: every query is bounded by the batch size', async () => {
      for (const model of ['user', 'transaction', 'donation', 'jobOpportunity', 'event']) {
        prismaMock[model].count.mockResolvedValue(0);
        prismaMock[model].findMany.mockResolvedValue([]);
      }
      for (const entity of ['users', 'transactions', 'donations', 'jobs', 'events']) await run(entity, { batchSize: 50 });
      for (const model of ['user', 'transaction', 'donation', 'jobOpportunity', 'event']) {
        expect(prismaMock[model].findMany).toHaveBeenCalledTimes(1);
        // one extra row tells the service whether more follow
        expect(prismaMock[model].findMany.mock.calls[0][0].take).toBe(51);
      }
    });

    it('reads in batches that continue after the last row written, with no row skipped or repeated', async () => {
      const all = arrangeUsers(25);

      const { csv } = await run('users', { batchSize: 10 });

      expect(prismaMock.user.findMany).toHaveBeenCalledTimes(3);
      expect(prismaMock.user.findMany.mock.calls.map((c: any[]) => c[0].take)).toEqual([11, 11, 11]);
      expect(prismaMock.user.findMany.mock.calls[0][0].where).toBeUndefined();
      expect(prismaMock.user.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      const lines = csv.split('\r\n');
      expect(lines).toHaveLength(26);
      expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual(all.map((u) => u.id));
      expect(lastAudit().newValues).toEqual({ entity: 'users', rows: 25, truncated: false });
    });

    it('does not ask for another batch after the last full one when nothing follows', async () => {
      arrangeUsers(20);
      const { csv } = await run('users', { batchSize: 10 });
      expect(csv.split('\r\n')).toHaveLength(21);
      expect(prismaMock.user.findMany).toHaveBeenCalledTimes(2);
    });

    it('stops at the hard row limit and ends the file with a clear marker row', async () => {
      arrangeUsers(25);

      const exported = await run('users', { batchSize: 10, maxRows: 15 });

      expect(exported.mayBeTruncated).toBe(true);
      const lines = exported.csv.split('\r\n');
      expect(lines).toHaveLength(1 + 15 + 1);
      expect(lines[15]).toContain('u0014');
      expect(lines[16]).toMatch(/^EXPORT TRUNCATED: .*first 15 rows/);
      expect(prismaMock.user.findMany.mock.calls.map((c: any[]) => c[0].take)).toEqual([11, 6]);
      expect(lastAudit().newValues).toEqual({ entity: 'users', rows: 15, truncated: true });
    });

    it('is not truncated when the table holds exactly the limit', async () => {
      arrangeUsers(15);
      const exported = await run('users', { batchSize: 10, maxRows: 15 });
      expect(exported.mayBeTruncated).toBe(false);
      expect(exported.csv.split('\r\n')).toHaveLength(16);
      expect(exported.csv).not.toContain('TRUNCATED');
      expect(lastAudit().newValues).toEqual({ entity: 'users', rows: 15, truncated: false });
    });

    it('takes the row limit from EXPORT_MAX_ROWS when set, and falls back to 100,000 otherwise', async () => {
      const original = process.env.EXPORT_MAX_ROWS;
      try {
        arrangeUsers(30);
        process.env.EXPORT_MAX_ROWS = '12';
        expect((await run('users', { batchSize: 10 })).csv.split('\r\n')).toHaveLength(1 + 12 + 1);
        process.env.EXPORT_MAX_ROWS = 'not a number';
        expect((await run('users', { batchSize: 10 })).csv.split('\r\n')).toHaveLength(1 + 30);
      } finally {
        if (original === undefined) delete process.env.EXPORT_MAX_ROWS;
        else process.env.EXPORT_MAX_ROWS = original;
      }
      expect(DEFAULT_EXPORT_MAX_ROWS).toBe(100_000);
      expect(EXPORT_BATCH_SIZE).toBe(1000);
    });

    it('neutralises formula injection in every streamed batch', async () => {
      prismaMock.user.count.mockResolvedValue(1);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', fullName: '=HYPERLINK("http://evil")', email: '@x.io', batchYear: 2019, department: '-1', userRole: 'MEMBER', isActive: true, createdAt: new Date('2026-01-01T00:00:00Z') },
      ]);
      const { csv } = await run('users');
      expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
      expect(csv).toContain(",'@x.io,");
      expect(csv).toContain(",'-1,");
    });

    it('sends the header row together with the first batch, so a failing first read leaves nothing half-written', async () => {
      prismaMock.user.count.mockResolvedValue(5);
      prismaMock.user.findMany.mockRejectedValue(new Error('db down'));
      const exported = await adminService.exportEntity(actor('ADMIN'), 'users');
      const received: string[] = [];
      await expect(
        (async () => {
          for await (const chunk of exported.chunks) received.push(chunk);
        })()
      ).rejects.toThrow('db down');
      expect(received).toEqual([]);
      expect(lastAudit().newValues).toEqual({ entity: 'users', rows: 0, truncated: false, aborted: true });
    });

    it('audits an export that stops part-way (client gone) with what was written', async () => {
      arrangeUsers(25);
      const exported = await adminService.exportEntity(actor('ADMIN'), 'users', {}, { batchSize: 10 });
      for await (const chunk of exported.chunks) {
        expect(chunk).toContain('ID,Name');
        break;
      }
      expect(lastAudit().newValues).toEqual({ entity: 'users', rows: 10, truncated: false, aborted: true });
    });

    it('audits who exported, with the request metadata', async () => {
      prismaMock.user.count.mockResolvedValue(0);
      prismaMock.user.findMany.mockResolvedValue([]);
      const exported = await adminService.exportEntity(actor('ADMIN', 'admin-9'), 'users', { ipAddress: '1.2.3.4', userAgent: 'jest' });
      await collect(exported.chunks);
      expect(lastAudit()).toMatchObject({ userId: 'admin-9', action: 'EXPORT_DATA', ipAddress: '1.2.3.4', userAgent: 'jest' });
    });

    it('labels guest transactions and donations with the donor details from the order metadata', async () => {
      const guestMeta = { donorName: 'Guest Donor', donorEmail: 'guest@example.com' };
      prismaMock.transaction.count.mockResolvedValue(2);
      prismaMock.transaction.findMany.mockResolvedValue([
        { id: 't1', type: 'DONATION', status: 'SUCCESS', amount: 250, currency: 'INR', user: null, metadata: guestMeta },
        { id: 't2', type: 'DONATION', status: 'PENDING', amount: 10, currency: 'INR', user: null, metadata: null },
      ]);
      const tx = await run('transactions');
      expect(tx.csv).toContain('Guest Donor (guest)');
      expect(tx.csv).toContain('guest@example.com');
      expect(tx.csv).toContain('Guest');

      prismaMock.donation.count.mockResolvedValue(2);
      prismaMock.donation.findMany.mockResolvedValue([
        { id: 'd1', amount: 250, currency: 'INR', isAnonymous: false, user: null, transaction: { metadata: guestMeta } },
        { id: 'd2', amount: 250, currency: 'INR', isAnonymous: true, user: null, transaction: { metadata: guestMeta } },
      ]);
      const don = await run('donations');
      const [, visible, anonymous] = don.csv.split('\r\n');
      expect(visible).toContain('Guest Donor (guest)');
      expect(visible).toContain('guest@example.com');
      expect(anonymous).toContain('Anonymous');
      expect(anonymous).not.toContain('guest@example.com');
    });

    it('orders events by start date, newest first, with the id as tie-breaker', async () => {
      prismaMock.event.count.mockResolvedValue(0);
      prismaMock.event.findMany.mockResolvedValue([]);
      await run('events');
      expect(prismaMock.event.findMany.mock.calls[0][0].orderBy).toEqual([{ startDate: 'desc' }, { id: 'desc' }]);
    });

    it('rejects unknown entities with 400 before touching the database', async () => {
      await expect(adminService.exportEntity(actor('ADMIN'), 'refreshTokens')).rejects.toMatchObject({ statusCode: 400 });
      await expect(adminService.exportEntity(actor('ADMIN'), 'constructor')).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
