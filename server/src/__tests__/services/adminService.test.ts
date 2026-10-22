import { adminService } from '../../services/adminService';
import * as socketUtil from '../../utils/socket';
import { prismaMock } from '../../../tests/helpers';

const actor = (userRole: any, id = 'actor') => ({ id, userRole });
const target = (userRole: any, extra: Record<string, unknown> = {}) => ({
  id: 'target',
  email: 't@aitd.test',
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
    it('exports users as CSV without credentials and audits the export', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'u1', fullName: 'Ann', email: 'ann@x.io', batchYear: 2019, department: 'CSE', userRole: 'MEMBER', isActive: true, createdAt: new Date('2026-01-01T00:00:00Z') },
      ]);

      const { filename, csv } = await adminService.exportEntity(actor('ADMIN'), 'users');

      expect(filename).toMatch(/^users-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(csv.split('\r\n')[0]).toContain('Email');
      expect(csv).toContain('ann@x.io');
      expect(csv).not.toMatch(/password/i);
      expect(prismaMock.user.findMany.mock.calls[0][0].select.passwordHash).toBeUndefined();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'EXPORT_DATA', entityType: 'SYSTEM', newValues: { entity: 'users', rows: 1 } }),
      });
    });

    it.each(['transactions', 'donations', 'jobs', 'events'])('supports %s', async (entity) => {
      const model = { transactions: 'transaction', donations: 'donation', jobs: 'jobOpportunity', events: 'event' }[entity]!;
      prismaMock[model].findMany.mockResolvedValue([]);
      const { csv } = await adminService.exportEntity(actor('ADMIN'), entity);
      expect(csv.split('\r\n')).toHaveLength(1);
    });

    it('labels guest transactions and donations with the donor details from the order metadata', async () => {
      const guestMeta = { donorName: 'Guest Donor', donorEmail: 'guest@example.com' };
      prismaMock.transaction.findMany.mockResolvedValue([
        { id: 't1', type: 'DONATION', status: 'SUCCESS', amount: 250, currency: 'INR', user: null, metadata: guestMeta },
        { id: 't2', type: 'DONATION', status: 'PENDING', amount: 10, currency: 'INR', user: null, metadata: null },
      ]);
      const tx = await adminService.exportEntity(actor('ADMIN'), 'transactions');
      expect(tx.csv).toContain('Guest Donor (guest)');
      expect(tx.csv).toContain('guest@example.com');
      expect(tx.csv).toContain('Guest');

      prismaMock.donation.findMany.mockResolvedValue([
        { id: 'd1', amount: 250, currency: 'INR', isAnonymous: false, user: null, transaction: { metadata: guestMeta } },
        { id: 'd2', amount: 250, currency: 'INR', isAnonymous: true, user: null, transaction: { metadata: guestMeta } },
      ]);
      const don = await adminService.exportEntity(actor('ADMIN'), 'donations');
      const [, visible, anonymous] = don.csv.split('\r\n');
      expect(visible).toContain('Guest Donor (guest)');
      expect(visible).toContain('guest@example.com');
      expect(anonymous).toContain('Anonymous');
      expect(anonymous).not.toContain('guest@example.com');
    });

    it('rejects unknown entities with 400', async () => {
      await expect(adminService.exportEntity(actor('ADMIN'), 'refreshTokens')).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
