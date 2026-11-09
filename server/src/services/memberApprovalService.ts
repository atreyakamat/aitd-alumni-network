import { ApprovalStatus, Prisma } from '@prisma/client';
import prisma from '../config/database';
import config from '../config';
import { AppError } from '../middleware/errorHandler';
import { Actor } from '../config/permissions';
import { buildPaginationResponse, paginationHelper, ilike } from '../utils/helpers';
import { logAuditAction } from './auditService';
import { publishNotificationEvent } from './notificationBus';
import { log } from '../utils/logger';

/**
 * Alumni approval: the review queue an administrator works through.
 *
 * A registration is a claim ("I am an alumnus of the college"). Nobody gets a session (and nobody appears in the
 * directory, search or any list) until an administrator has checked the claim and approved it. Approving sets
 * `approvalStatus = APPROVED` together with `isVerified = true`: isVerified is what every listing filters on.
 */

export interface ApprovalRequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface ApprovalListFilters {
  status?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

const STATUSES: readonly ApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const MAX_NOTE_LENGTH = 500;
const MIN_REASON_LENGTH = 3;

/** What the reviewer needs to decide. No password hash, no tokens, no phone number. */
const APPLICATION_SELECT = {
  id: true,
  fullName: true,
  email: true,
  batchYear: true,
  department: true,
  degree: true,
  roleType: true,
  enrollmentNumber: true,
  verificationNote: true,
  linkedinUrl: true,
  isActive: true,
  createdAt: true,
  emailVerifiedAt: true,
  approvalStatus: true,
  approvalReviewedAt: true,
  approvalNote: true,
  approvalReviewedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.UserSelect;

const trimmed = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The applicant's e-mail is an event on the notification bus (Kafka). The decision never waits for it and never fails
 * because of it: if the event cannot be published (and the in-process fallback fails too) it is logged.
 */
const announce = (type: 'registration.approved' | 'registration.rejected', data: { userId: string; reason?: string }) => {
  void publishNotificationEvent(type, data as never).catch((error: unknown) =>
    log.error(`Could not publish the ${type} event`, { userId: data.userId, err: error })
  );
};

class MemberApprovalService {
  async list(filters: ApprovalListFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const { skip, take } = paginationHelper(page, limit);

    const status = STATUSES.includes(filters.status as ApprovalStatus) ? (filters.status as ApprovalStatus) : 'PENDING';
    const where: Prisma.UserWhereInput = { approvalStatus: status };
    const search = trimmed(filters.search);
    if (search) {
      where.OR = [{ fullName: ilike(search) }, { email: ilike(search) }, { enrollmentNumber: ilike(search) }];
    }

    // The queue is worked oldest first; what was decided is read newest first
    const orderBy: Prisma.UserOrderByWithRelationInput =
      status === 'PENDING' ? { createdAt: 'asc' } : { approvalReviewedAt: { sort: 'desc', nulls: 'last' } };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({ where, select: APPLICATION_SELECT, orderBy, skip, take }),
      prisma.user.count({ where }),
    ]);

    return buildPaginationResponse(rows, total, page, limit);
  }

  async summary() {
    const groups = await prisma.user.groupBy({ by: ['approvalStatus'], _count: { _all: true } });
    const count = (status: ApprovalStatus) => groups.find((g) => g.approvalStatus === status)?._count._all ?? 0;
    return { pending: count('PENDING'), approved: count('APPROVED'), rejected: count('REJECTED') };
  }

  private async load(targetId: string) {
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, fullName: true, email: true, approvalStatus: true, emailVerifiedAt: true },
    });
    if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');
    return target;
  }

  async approve(actor: Pick<Actor, 'id'>, targetId: string, note: unknown, meta: ApprovalRequestMeta = {}) {
    const noteText = trimmed(note);
    if (noteText.length > MAX_NOTE_LENGTH) {
      throw new AppError(`The note can be at most ${MAX_NOTE_LENGTH} characters`, 400, 'VALIDATION_ERROR');
    }

    const target = await this.load(targetId);
    if (target.approvalStatus === 'APPROVED') {
      throw new AppError('This person is already approved', 409, 'ALREADY_APPROVED');
    }
    // Anyone can register an address that is not theirs. While verification is required, approving an address nobody has
    // proven to own would hand a member account to whoever typed it.
    if (config.auth.requireEmailVerification && !target.emailVerifiedAt) {
      throw new AppError(
        'This person has not verified their e-mail address yet. Approve after they have used the link we mailed to them.',
        409,
        'EMAIL_NOT_VERIFIED'
      );
    }

    // Conditional update: of two administrators acting at the same moment only one claims the change
    const claimed = await prisma.user.updateMany({
      where: { id: targetId, approvalStatus: { not: 'APPROVED' } },
      data: {
        approvalStatus: 'APPROVED',
        isVerified: true,
        approvalReviewedAt: new Date(),
        approvalReviewedById: actor.id,
        approvalNote: noteText || null,
      },
    });
    if (claimed.count !== 1) {
      throw new AppError('This person is already approved', 409, 'ALREADY_APPROVED');
    }

    await logAuditAction({
      userId: actor.id,
      action: 'APPROVE',
      entityType: 'USER',
      entityId: targetId,
      oldValues: { approvalStatus: target.approvalStatus },
      newValues: { approvalStatus: 'APPROVED', ...(noteText ? { note: noteText } : {}) },
      ...meta,
    });

    announce('registration.approved', { userId: targetId });

    return prisma.user.findUnique({ where: { id: targetId }, select: APPLICATION_SELECT });
  }

  async reject(actor: Pick<Actor, 'id'>, targetId: string, reason: unknown, meta: ApprovalRequestMeta = {}) {
    const reasonText = trimmed(reason);
    if (reasonText.length < MIN_REASON_LENGTH || reasonText.length > MAX_NOTE_LENGTH) {
      throw new AppError(
        `Give the reason (${MIN_REASON_LENGTH} to ${MAX_NOTE_LENGTH} characters): the person is told why`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const target = await this.load(targetId);
    // A member who is already approved is deactivated (admin users page), not "rejected"
    if (target.approvalStatus !== 'PENDING') {
      throw new AppError('Only a registration that is waiting for approval can be rejected', 409, 'NOT_PENDING');
    }

    const claimed = await prisma.user.updateMany({
      where: { id: targetId, approvalStatus: 'PENDING' },
      data: {
        approvalStatus: 'REJECTED',
        isVerified: false,
        approvalReviewedAt: new Date(),
        approvalReviewedById: actor.id,
        approvalNote: reasonText,
      },
    });
    if (claimed.count !== 1) {
      throw new AppError('Only a registration that is waiting for approval can be rejected', 409, 'NOT_PENDING');
    }

    await logAuditAction({
      userId: actor.id,
      action: 'REJECT',
      entityType: 'USER',
      entityId: targetId,
      oldValues: { approvalStatus: 'PENDING' },
      newValues: { approvalStatus: 'REJECTED', reason: reasonText },
      ...meta,
    });

    announce('registration.rejected', { userId: targetId, reason: reasonText });

    return prisma.user.findUnique({ where: { id: targetId }, select: APPLICATION_SELECT });
  }
}

export const memberApprovalService = new MemberApprovalService();
