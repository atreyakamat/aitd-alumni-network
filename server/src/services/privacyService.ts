import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { comparePassword } from '../utils/password';
import { checkPasswordWithBudget } from './attemptLimiter';
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
  homeLat: true,
  homeLng: true,
  workLat: true,
  workLng: true,
  workCity: true,
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
  digestOptOut: true,
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
      follows,
      savedPosts,
      invitesSent,
      reactions,
      commentReactions,
      reportsFiled,
      galleryPhotos,
      eventsCreated,
      collegeVideos,
      requirementResponses,
      referrals,
      activityLog,
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
      prisma.follow.findMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } }),
      prisma.savedPost.findMany({ where: { userId } }),
      // Invite tokens are bearer secrets: never exported
      prisma.invite.findMany({
        where: { inviterId: userId },
        select: { id: true, email: true, name: true, batchYear: true, status: true, isShareable: true, createdAt: true, expiresAt: true, acceptedAt: true },
      }),
      // Everything else the member wrote or did that is stored against their id
      prisma.postLike.findMany({ where: { userId } }),
      prisma.commentReaction.findMany({ where: { userId } }),
      prisma.contentReport.findMany({
        where: { reporterId: userId },
        select: { id: true, postId: true, commentId: true, reason: true, details: true, status: true, createdAt: true },
      }),
      prisma.galleryPhoto.findMany({ where: { uploadedById: userId } }),
      prisma.event.findMany({ where: { createdById: userId } }),
      // College features: videos submitted, offers to help the college, job referral asks sent or received
      prisma.collegeVideo.findMany({ where: { submittedById: userId } }),
      prisma.requirementResponse.findMany({ where: { userId }, include: { requirement: { select: { id: true, title: true } } } }),
      prisma.referralRequest.findMany({ where: { OR: [{ requesterId: userId }, { targetId: userId }] } }),
      prisma.auditLog.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
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
      // The checkout signature is a payment credential, not something a data subject needs
      transactions: (transactions ?? []).map(({ gatewaySignature: _signature, ...rest }) => rest),
      donations,
      memberships,
      chapters,
      mentorship,
      marketplaceListings,
      notifications,
      follows,
      savedPosts,
      invitesSent,
      reactions,
      commentReactions,
      reportsFiled,
      galleryPhotos,
      eventsCreated,
      collegeVideos,
      requirementResponses,
      referrals,
      activityLog,
    };
  }

  async deleteMyAccount(userId: string, input: DeleteAccountInput, meta: RequestMeta = {}) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, userRole: true, passwordHash: true },
    });
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

    if (user.passwordHash) {
      const { password } = input;
      const currentHash = user.passwordHash;
      // Shares the per-account budget with change-password: a stolen token cannot guess the password here
      const ok = password ? await checkPasswordWithBudget(userId, () => comparePassword(password, currentHash)) : false;
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
      // Social graph and bookmarks exist only because of this user
      await tx.follow.deleteMany({ where: { OR: [{ followerId: userId }, { followingId: userId }] } });
      await tx.savedPost.deleteMany({ where: { userId } });
      await tx.postImpression.deleteMany({ where: { userId } });
      // The audit trail keeps WHAT happened (accountability) but not WHERE FROM: the address and browser are personal data
      await tx.auditLog.updateMany({ where: { userId }, data: { ipAddress: null, userAgent: null } });
      // Invites sent by the user carry third parties' e-mail addresses; invites addressed to
      // them carry their own address (the account row is anonymised below)
      await tx.invite.deleteMany({ where: { OR: [{ inviterId: userId }, { email: user.email }] } });
      // College features. Referral asks and offers to help carry the member's own words about a third party or an
      // employer; submitted videos that never went public are theirs alone. A video the college PUBLISHED stays, like a
      // post, attributed to "Deleted User". Requirements and magazine issues are posted by admins for the college.
      await tx.referralRequest.deleteMany({ where: { OR: [{ requesterId: userId }, { targetId: userId }] } });
      await tx.requirementResponse.deleteMany({ where: { userId } });
      await tx.collegeVideo.deleteMany({ where: { submittedById: userId, status: { not: 'APPROVED' } } });
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
          // precise residence / work location: the most sensitive location data the account holds
          homeLat: null,
          homeLng: null,
          workLat: null,
          workLng: null,
          workCity: null,
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

    // Recorded without the request's address / user agent, for the same reason as above
    await logAuditAction({
      userId,
      action: 'DELETE',
      entityType: 'USER',
      entityId: userId,
    });

    return { message: 'Account deleted' };
  }
}

export const privacyService = new PrivacyService();
