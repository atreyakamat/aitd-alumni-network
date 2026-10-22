import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { comparePassword } from '../utils/password';
import { logAuditAction } from './auditService';
import type { RequestMeta } from './adminService';
import { disconnectUser } from '../utils/socket';

const PROFILE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  profilePhotoUrl: true,
  coverPhotoUrl: true,
  batchYear: true,
  department: true,
  degree: true,
  roleType: true,
  currentDesignation: true,
  shortBio: true,
  city: true,
  hometown: true,
  locationLat: true,
  locationLng: true,
  isLocationPublic: true,
  phoneNumber: true,
  phoneVisibility: true,
  linkedinUrl: true,
  twitterUrl: true,
  githubUrl: true,
  websiteUrl: true,
  secondaryEmail: true,
  userRole: true,
  isVerified: true,
  twoFactorEnabled: true,
  createdAt: true,
  lastLoginAt: true,
  workExperiences: true,
  educations: true,
  skills: { include: { skill: true } },
  mentorProfile: true,
};

export interface DeleteAccountInput {
  password?: string;
  confirm?: string;
}

/**
 * Self-service privacy controls (PRD §8.5): data export and account deletion.
 */
export class PrivacyService {
  async exportMyData(userId: string, meta: RequestMeta = {}) {
    const profile = await prisma.user.findUnique({ where: { id: userId }, select: PROFILE_SELECT });
    if (!profile) throw new AppError('User not found', 404, 'NOT_FOUND');

    const [
      posts,
      comments,
      jobs,
      eventRsvps,
      connections,
      messages,
      transactions,
      donations,
      memberships,
      chapters,
      mentorship,
      marketplaceListings,
      notifications,
    ] = await Promise.all([
      prisma.post.findMany({ where: { userId } }),
      prisma.postComment.findMany({ where: { userId } }),
      prisma.jobOpportunity.findMany({ where: { postedById: userId } }),
      prisma.eventRSVP.findMany({ where: { userId }, include: { event: { select: { id: true, title: true, startDate: true } } } }),
      prisma.connection.findMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } }),
      prisma.message.findMany({ where: { OR: [{ senderId: userId }, { receiverId: userId }] } }),
      prisma.transaction.findMany({ where: { userId } }),
      prisma.donation.findMany({ where: { userId } }),
      prisma.userMembership.findMany({ where: { userId }, include: { tier: { select: { name: true } } } }),
      prisma.chapterMembership.findMany({ where: { userId }, include: { chapter: { select: { id: true, name: true } } } }),
      prisma.mentorshipRequest.findMany({ where: { OR: [{ menteeId: userId }, { mentorId: userId }] }, include: { sessions: true } }),
      prisma.marketplaceListing.findMany({ where: { userId } }),
      prisma.notification.findMany({ where: { userId } }),
    ]);

    await logAuditAction({
      userId,
      action: 'EXPORT_DATA',
      entityType: 'USER',
      entityId: userId,
      ...meta,
    });

    return {
      exportedAt: new Date().toISOString(),
      profile,
      posts,
      comments,
      jobs,
      eventRsvps,
      connections,
      messages,
      transactions,
      donations,
      memberships,
      chapters,
      mentorship,
      marketplaceListings,
      notifications,
    };
  }

  async deleteMyAccount(userId: string, input: DeleteAccountInput, meta: RequestMeta = {}) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, userRole: true, passwordHash: true },
    });
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    if (user.passwordHash) {
      const ok = input.password ? await comparePassword(input.password, user.passwordHash) : false;
      if (!ok) throw new AppError('Password is incorrect', 401, 'INVALID_PASSWORD');
    } else if (input.confirm !== 'DELETE') {
      throw new AppError('Type DELETE to confirm account deletion', 400, 'CONFIRMATION_REQUIRED');
    }

    if (user.userRole === 'SUPER_ADMIN') {
      const superAdmins = await prisma.user.count({ where: { userRole: 'SUPER_ADMIN', isActive: true } });
      if (superAdmins <= 1) {
        throw new AppError('Assign another super admin before deleting this account', 409, 'LAST_SUPER_ADMIN');
      }
    }

    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.verificationToken.deleteMany({ where: { userId } });
      await tx.workExperience.deleteMany({ where: { userId } });
      await tx.education.deleteMany({ where: { userId } });
      await tx.userSkill.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.connection.deleteMany({ where: { OR: [{ requesterId: userId }, { addresseeId: userId }] } });
      await tx.marketplaceListing.deleteMany({ where: { userId } });
      // Deactivate (not delete) so mentees keep their request/session history
      await tx.mentorProfile.updateMany({ where: { userId }, data: { isActive: false, bio: null, availability: null } });

      // Posts, comments, donations and transactions stay (attributed to
      // "Deleted User") so threads and financial records remain consistent.
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@deleted.invalid`,
          fullName: 'Deleted User',
          passwordHash: null,
          isActive: false,
          isNotable: false,
          profilePhotoUrl: null,
          coverPhotoUrl: null,
          currentDesignation: null,
          shortBio: null,
          city: null,
          hometown: null,
          locationLat: null,
          locationLng: null,
          isLocationPublic: false,
          phoneNumber: null,
          phoneVisibility: 'PRIVATE',
          linkedinUrl: null,
          twitterUrl: null,
          githubUrl: null,
          websiteUrl: null,
          secondaryEmail: null,
          twoFactorEnabled: false,
          userRole: 'MEMBER',
          // Revoke every access token still in circulation
          tokenVersion: { increment: 1 },
        },
      });
    });
    disconnectUser(userId);

    await logAuditAction({
      userId,
      action: 'DELETE',
      entityType: 'USER',
      entityId: userId,
      ...meta,
    });

    return { message: 'Account deleted' };
  }
}

export const privacyService = new PrivacyService();
