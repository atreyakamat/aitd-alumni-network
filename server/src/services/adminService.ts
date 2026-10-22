import { Prisma, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { Actor, ROLES, canAssignRole, canManageUser } from '../config/permissions';
import { logAuditAction } from './auditService';
import { buildPaginationResponse, paginationHelper, ilike } from '../utils/helpers';
import { CsvColumn, toCsv } from '../utils/csv';
import { guestDonorFromMetadata } from './donationService';
import { disconnectUser } from '../utils/socket';

export interface ListUsersFilters {
  search?: string;
  role?: string;
  isActive?: string | boolean;
  batchYear?: string | number;
  page?: number;
  limit?: number;
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  profilePhotoUrl: true,
  batchYear: true,
  department: true,
  roleType: true,
  userRole: true,
  isActive: true,
  isVerified: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const parseBool = (value: unknown): boolean | undefined => {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
};

const stamp = () => new Date().toISOString().slice(0, 10);

const guestLabel = (metadata: unknown) => `${guestDonorFromMetadata(metadata).name} (guest)`;

type ExportDefinition = {
  load: () => Promise<any[]>;
  columns: CsvColumn<any>[];
};

const EXPORTS: Record<string, ExportDefinition> = {
  users: {
    load: () =>
      prisma.user.findMany({ select: ADMIN_USER_SELECT, orderBy: { createdAt: 'desc' } }),
    columns: [
      { key: 'id', header: 'ID' },
      { key: 'fullName', header: 'Name' },
      { key: 'email', header: 'Email' },
      { key: 'batchYear', header: 'Batch' },
      { key: 'department', header: 'Department' },
      { key: 'userRole', header: 'Role' },
      { key: 'isActive', header: 'Active' },
      { key: 'createdAt', header: 'Joined' },
    ],
  },
  transactions: {
    load: () =>
      prisma.transaction.findMany({
        include: { user: { select: { fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    columns: [
      { key: 'id', header: 'ID' },
      { key: 'type', header: 'Type' },
      { key: 'status', header: 'Status' },
      { key: 'amount', header: 'Amount' },
      { key: 'currency', header: 'Currency' },
      // Guest donations have no user; their donor details live in the order metadata.
      {
        header: 'User',
        value: (t) => (t.user ? t.user.fullName : t.type === 'DONATION' ? guestLabel(t.metadata) : 'Deleted User'),
      },
      { header: 'Email', value: (t) => (t.user ? t.user.email : guestDonorFromMetadata(t.metadata).email) },
      { key: 'gatewayPaymentId', header: 'Payment ID' },
      { key: 'createdAt', header: 'Created' },
    ],
  },
  donations: {
    load: () =>
      prisma.donation.findMany({
        include: {
          user: { select: { fullName: true, email: true } },
          chapter: { select: { name: true } },
          transaction: { select: { metadata: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    columns: [
      { key: 'id', header: 'ID' },
      { key: 'amount', header: 'Amount' },
      { key: 'currency', header: 'Currency' },
      {
        header: 'Donor',
        value: (d) => (d.isAnonymous ? 'Anonymous' : d.user ? d.user.fullName : guestLabel(d.transaction?.metadata)),
      },
      {
        header: 'Email',
        value: (d) =>
          d.isAnonymous ? '' : d.user ? d.user.email : guestDonorFromMetadata(d.transaction?.metadata).email,
      },
      { header: 'Chapter', value: (d) => d.chapter?.name },
      { key: 'createdAt', header: 'Created' },
    ],
  },
  jobs: {
    load: () =>
      prisma.jobOpportunity.findMany({
        include: { postedBy: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    columns: [
      { key: 'id', header: 'ID' },
      { key: 'title', header: 'Title' },
      { key: 'company', header: 'Company' },
      { key: 'jobType', header: 'Type' },
      { key: 'status', header: 'Status' },
      { header: 'Posted By', value: (j) => j.postedBy?.fullName },
      { key: 'viewCount', header: 'Views' },
      { key: 'createdAt', header: 'Created' },
    ],
  },
  events: {
    load: () =>
      prisma.event.findMany({ orderBy: { startDate: 'desc' } }),
    columns: [
      { key: 'id', header: 'ID' },
      { key: 'title', header: 'Title' },
      { key: 'eventType', header: 'Type' },
      { key: 'status', header: 'Status' },
      { key: 'city', header: 'City' },
      { key: 'startDate', header: 'Starts' },
      { key: 'capacity', header: 'Capacity' },
      { key: 'rsvpCount', header: 'RSVPs' },
    ],
  },
};

export class AdminService {
  async listUsers(filters: ListUsersFilters) {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
    const { skip, take } = paginationHelper(page, limit);

    const where: Prisma.UserWhereInput = {};
    const search = filters.search?.trim();
    if (search) {
      where.OR = [{ fullName: ilike(search) }, { email: ilike(search) }];
    }
    if (filters.role && ROLES.includes(filters.role as UserRole)) {
      where.userRole = filters.role as UserRole;
    }
    const isActive = parseBool(filters.isActive);
    if (isActive !== undefined) where.isActive = isActive;
    const batchYear = Number(filters.batchYear);
    if (filters.batchYear !== undefined && Number.isInteger(batchYear)) where.batchYear = batchYear;

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, select: ADMIN_USER_SELECT, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.user.count({ where }),
    ]);

    return buildPaginationResponse(users, total, page, limit);
  }

  private async loadTarget(targetId: string) {
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, userRole: true, isActive: true, fullName: true, email: true },
    });
    if (!target) throw new AppError('User not found', 404, 'NOT_FOUND');
    return target;
  }

  async updateUserRole(actor: Actor, targetId: string, newRole: UserRole, meta: RequestMeta = {}) {
    if (!ROLES.includes(newRole)) {
      throw new AppError(`Role must be one of ${ROLES.join(', ')}`, 400, 'INVALID_ROLE');
    }

    const target = await this.loadTarget(targetId);

    if (!canAssignRole(actor, target, newRole)) {
      throw new AppError('You are not allowed to assign this role to this user', 403, 'FORBIDDEN');
    }

    if (target.userRole === newRole) return target;

    const updated = await prisma.user.update({
      where: { id: targetId },
      data: { userRole: newRole },
      select: ADMIN_USER_SELECT,
    });

    await logAuditAction({
      userId: actor.id,
      action: 'ROLE_CHANGE',
      entityType: 'USER',
      entityId: targetId,
      oldValues: { userRole: target.userRole },
      newValues: { userRole: newRole },
      ...meta,
    });

    return updated;
  }

  async updateUserStatus(actor: Actor, targetId: string, isActive: boolean, reason?: string, meta: RequestMeta = {}) {
    if (typeof isActive !== 'boolean') {
      throw new AppError('isActive must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const target = await this.loadTarget(targetId);

    if (!canManageUser(actor, target)) {
      throw new AppError('You are not allowed to change this user\'s status', 403, 'FORBIDDEN');
    }

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: targetId },
        // Deactivation bumps tokenVersion so access tokens issued before it stay
        // dead even if the account is later reactivated
        data: isActive ? { isActive } : { isActive, tokenVersion: { increment: 1 } },
        select: ADMIN_USER_SELECT,
      });

      if (!isActive) {
        // Force logout everywhere: refresh tokens can no longer mint access tokens
        await tx.refreshToken.deleteMany({ where: { userId: targetId } });
      }
      return user;
    });
    if (!isActive) disconnectUser(targetId);

    await logAuditAction({
      userId: actor.id,
      action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      entityType: 'USER',
      entityId: targetId,
      oldValues: { isActive: target.isActive },
      newValues: reason ? { isActive, reason } : { isActive },
      ...meta,
    });

    return updated;
  }

  async getPendingJobs(page = 1, limit = 20) {
    const { skip, take } = paginationHelper(page, limit);
    const where: Prisma.JobOpportunityWhereInput = { status: 'PENDING_REVIEW' };

    const [jobs, total] = await Promise.all([
      prisma.jobOpportunity.findMany({
        where,
        include: { postedBy: { select: { id: true, fullName: true, email: true, batchYear: true } } },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      prisma.jobOpportunity.count({ where }),
    ]);

    return buildPaginationResponse(jobs, total, page, limit);
  }

  async getMentorshipOverview() {
    const [totalMentors, activeMentors, byStatus, totalSessions, completedSessions] = await Promise.all([
      prisma.mentorProfile.count(),
      prisma.mentorProfile.count({ where: { isActive: true } }),
      prisma.mentorshipRequest.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.mentorshipSession.count(),
      prisma.mentorshipSession.count({ where: { completed: true } }),
    ]);

    const requests: Record<string, number> = {};
    let total = 0;
    for (const row of byStatus as Array<{ status: string; _count: { _all: number } }>) {
      requests[row.status] = row._count._all;
      total += row._count._all;
    }

    return {
      mentors: { total: totalMentors, active: activeMentors },
      requests: { ...requests, total },
      sessions: {
        total: totalSessions,
        completed: completedSessions,
        completionRate: totalSessions ? Math.round((completedSessions / totalSessions) * 100) : 0,
      },
    };
  }

  async exportEntity(actor: Actor, entity: string, meta: RequestMeta = {}) {
    const definition = Object.prototype.hasOwnProperty.call(EXPORTS, entity) ? EXPORTS[entity] : undefined;
    if (!definition) {
      throw new AppError(`Unsupported export. Choose one of: ${Object.keys(EXPORTS).join(', ')}`, 400, 'INVALID_EXPORT');
    }

    const rows = await definition.load();
    const csv = toCsv(rows, definition.columns);

    await logAuditAction({
      userId: actor.id,
      action: 'EXPORT_DATA',
      entityType: 'SYSTEM',
      newValues: { entity, rows: rows.length },
      ...meta,
    });

    return { filename: `${entity}-${stamp()}.csv`, csv };
  }
}

export const adminService = new AdminService();
