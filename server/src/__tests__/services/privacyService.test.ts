import * as socketUtil from '../../utils/socket';
import { privacyService } from '../../services/privacyService';
import { prismaMock } from '../../../tests/helpers';
import { hashPassword } from '../../utils/password';

describe('privacyService', () => {
  describe('exportMyData', () => {
    it('returns the full account footprint without credentials and audits it', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'u1@x.io', fullName: 'U One', workExperiences: [], skills: [] });
      prismaMock.post.findMany.mockResolvedValue([{ id: 'p1' }]);
      prismaMock.postComment.findMany.mockResolvedValue([]);
      prismaMock.jobOpportunity.findMany.mockResolvedValue([]);
      prismaMock.eventRSVP.findMany.mockResolvedValue([]);
      prismaMock.connection.findMany.mockResolvedValue([]);
      prismaMock.message.findMany.mockResolvedValue([{ id: 'm1' }]);
      prismaMock.transaction.findMany.mockResolvedValue([]);
      prismaMock.donation.findMany.mockResolvedValue([]);
      prismaMock.userMembership.findMany.mockResolvedValue([]);
      prismaMock.chapterMembership.findMany.mockResolvedValue([]);
      prismaMock.mentorshipRequest.findMany.mockResolvedValue([]);
      prismaMock.marketplaceListing.findMany.mockResolvedValue([]);
      prismaMock.notification.findMany.mockResolvedValue([]);

      const data = await privacyService.exportMyData('u1');

      const userArgs = prismaMock.user.findUnique.mock.calls[0][0];
      expect(userArgs.where).toEqual({ id: 'u1' });
      expect(userArgs.select.passwordHash).toBeUndefined();
      expect(data.profile).toMatchObject({ id: 'u1', email: 'u1@x.io' });
      expect(data.posts).toEqual([{ id: 'p1' }]);
      expect(data.messages).toEqual([{ id: 'm1' }]);
      expect(data.exportedAt).toEqual(expect.any(String));
      expect(prismaMock.message.findMany.mock.calls[0][0].where).toEqual({ OR: [{ senderId: 'u1' }, { receiverId: 'u1' }] });
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', action: 'EXPORT_DATA', entityType: 'USER', entityId: 'u1' }),
      });
    });

    it('404s for a missing user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(privacyService.exportMyData('nope')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('deleteMyAccount', () => {
    let passwordHash: string;
    beforeAll(async () => {
      passwordHash = await hashPassword('Correct#Pass1');
    });

    const arrangeUser = (extra: Record<string, unknown> = {}) =>
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', userRole: 'MEMBER', passwordHash, ...extra });

    it('requires the current password', async () => {
      arrangeUser();
      await expect(privacyService.deleteMyAccount('u1', { password: 'wrong' })).rejects.toMatchObject({ statusCode: 401 });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('requires explicit confirmation for password-less (OAuth) accounts', async () => {
      arrangeUser({ passwordHash: null });
      await expect(privacyService.deleteMyAccount('u1', {})).rejects.toMatchObject({ statusCode: 400 });
      arrangeUser({ passwordHash: null });
      prismaMock.user.update.mockResolvedValue({});
      await expect(privacyService.deleteMyAccount('u1', { confirm: 'DELETE' })).resolves.toEqual({ message: 'Account deleted' });
    });

    it('anonymises the account, wipes personal data and revokes sessions', async () => {
      arrangeUser();
      prismaMock.user.update.mockResolvedValue({});
      const disconnect = jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);

      await privacyService.deleteMyAccount('u1', { password: 'Correct#Pass1' });

      const update = prismaMock.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'u1' });
      expect(update.data).toMatchObject({
        email: 'deleted-u1@deleted.invalid',
        fullName: 'Deleted User',
        passwordHash: null,
        isActive: false,
        phoneNumber: null,
        shortBio: null,
        locationLat: null,
        locationLng: null,
        isLocationPublic: false,
        linkedinUrl: null,
        profilePhotoUrl: null,
        twoFactorEnabled: false,
        // Outstanding access tokens are revoked too, not just refresh tokens
        tokenVersion: { increment: 1 },
      });
      for (const model of ['refreshToken', 'verificationToken', 'workExperience', 'education', 'userSkill', 'notification', 'connection', 'marketplaceListing']) {
        expect(prismaMock[model].deleteMany).toHaveBeenCalled();
      }
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prismaMock.connection.deleteMany).toHaveBeenCalledWith({
        where: { OR: [{ requesterId: 'u1' }, { addresseeId: 'u1' }] },
      });
      expect(prismaMock.mentorProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { isActive: false, bio: null, availability: null },
      });
      expect(prismaMock.mentorProfile.deleteMany).not.toHaveBeenCalled();
      // Financial records are retained for accounting/receipts
      expect(prismaMock.transaction.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.transaction.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.donation.deleteMany).not.toHaveBeenCalled();
      // The user row is anonymised, never hard-deleted (a hard delete would null Transaction.userId)
      expect(prismaMock.user.delete).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'DELETE', entityType: 'USER', entityId: 'u1' }),
      });
      // Live sockets close with the account
      expect(disconnect).toHaveBeenCalledWith('u1');
    });

    it('blocks the last super admin from deleting themselves', async () => {
      arrangeUser({ userRole: 'SUPER_ADMIN' });
      prismaMock.user.count.mockResolvedValue(1);
      await expect(privacyService.deleteMyAccount('u1', { password: 'Correct#Pass1' })).rejects.toMatchObject({
        statusCode: 409,
      });
    });

    it('allows a super admin to leave when another super admin exists', async () => {
      arrangeUser({ userRole: 'SUPER_ADMIN' });
      prismaMock.user.count.mockResolvedValue(2);
      prismaMock.user.update.mockResolvedValue({});
      await expect(privacyService.deleteMyAccount('u1', { password: 'Correct#Pass1' })).resolves.toBeDefined();
    });
  });
});
