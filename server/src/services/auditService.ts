import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper } from '../utils/helpers';

/** Audit logs younger than this can never be purged (retention floor). */
export const MIN_AUDIT_RETENTION_DAYS = 30;
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;

// Runtime lists so the client's admin audit filters can be checked against them
// (src/__tests__/services/auditContract.test.ts).
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'APPROVE',
  'REJECT',
  'ACTIVATE',
  'DEACTIVATE',
  'LOGIN',
  'LOGOUT',
  'PASSWORD_CHANGE',
  'SECURITY_ALERT',
  'ROLE_CHANGE',
  'BULK_INVITE',
  'EXPORT_DATA',
  // Gateway reported a paid amount/currency that differs from the transaction (left for reconciliation)
  'PAYMENT_MISMATCH',
  // Moderation of reported posts/comments (reportService)
  'CONTENT_REMOVED',
  'REPORT_DISMISSED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ENTITY_TYPES = [
  'USER',
  'POST',
  'COMMENT',
  'JOB',
  'EVENT',
  'NEWS',
  'MEMBERSHIP',
  'DONATION',
  'CHAPTER',
  'GALLERY',
  'MARKETPLACE_ITEM',
  'INVITATION',
  'MENTORSHIP',
  'TRANSACTION',
  'SYSTEM',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

interface AuditLogParams {
  userId?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  oldValues?: Prisma.InputJsonValue;
  newValues?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create an audit log entry
 */
export async function logAuditAction(params: AuditLogParams) {
  try {
    if (!params || !params.action || !params.entityType) {
      console.error('Refusing to write incomplete audit log entry:', params);
      return null;
    }
    return await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValues: params.oldValues,
        newValues: params.newValues,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    // Log but don't throw - audit logging should not break the main flow
    console.error('Failed to create audit log:', error);
    return null;
  }
}

export interface AuditActor {
  id: string;
  fullName: string;
  email: string;
}

/**
 * AuditLog has no relation to User (entries must outlive deleted accounts), so the acting
 * user is resolved with one batched lookup. Best-effort: a failed lookup leaves `user: null`.
 */
async function attachActors<T extends { userId?: string | null }>(logs: T[]): Promise<Array<T & { user: AuditActor | null }>> {
  const ids = Array.from(new Set(logs.map((log) => log.userId).filter((v): v is string => typeof v === 'string' && v !== '')));
  const byId = new Map<string, AuditActor>();
  if (ids.length > 0) {
    try {
      const users = (await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullName: true, email: true },
      })) || [];
      for (const user of users) byId.set(user.id, user);
    } catch (error) {
      console.error('Failed to resolve audit log actors:', error);
    }
  }
  return logs.map((log) => ({ ...log, user: (log.userId && byId.get(log.userId)) || null }));
}

/**
 * Get audit logs with filtering and pagination
 */
export async function getAuditLogs(options: {
  userId?: string;
  entityType?: AuditEntityType;
  action?: AuditAction;
  entityId?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}) {
  const { userId, entityType, action, entityId, startDate, endDate } = options;
  const { skip, take, page, limit } = paginationHelper(options.page ?? 1, options.limit ?? 50);

  const where: Record<string, unknown> = {};

  if (userId) where.userId = userId;
  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (entityId) where.entityId = entityId;
  const validDate = (d?: Date) => d instanceof Date && !Number.isNaN(d.getTime());
  if (validDate(startDate) || validDate(endDate)) {
    where.createdAt = {};
    if (validDate(startDate)) (where.createdAt as Record<string, Date>).gte = startDate!;
    if (validDate(endDate)) (where.createdAt as Record<string, Date>).lte = endDate!;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs: await attachActors(logs),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Get audit logs for a specific entity
 */
export async function getEntityAuditHistory(
  entityType: AuditEntityType,
  entityId: string
) {
  return prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
}

/**
 * Get recent admin activity
 */
export async function getRecentAdminActivity(rawLimit = 20) {
  const limit = Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.floor(rawLimit))) : 20;
  return prisma.auditLog.findMany({
    where: {
      userId: { not: null },
      action: {
        in: ['APPROVE', 'REJECT', 'DELETE', 'ACTIVATE', 'DEACTIVATE', 'ROLE_CHANGE'],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Delete old audit logs (for data retention compliance)
 */
export async function deleteOldAuditLogs(daysToKeep = DEFAULT_AUDIT_RETENTION_DAYS) {
  if (!Number.isInteger(daysToKeep) || daysToKeep < MIN_AUDIT_RETENTION_DAYS) {
    throw new AppError(
      `daysToKeep must be an integer of at least ${MIN_AUDIT_RETENTION_DAYS}`,
      400,
      'VALIDATION_ERROR'
    );
  }
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  return result.count;
}
