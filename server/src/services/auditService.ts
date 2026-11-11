import prisma from '../config/database';
import { Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper } from '../utils/helpers';
import { log } from '../utils/logger';

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
      // only the identifying fields: the old/new values can hold personal data
      log.error('Refusing to write incomplete audit log entry', {
        action: params?.action,
        entityType: params?.entityType,
        entityId: params?.entityId,
      });
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
    log.error('Failed to create audit log', { action: params.action, entityType: params.entityType, entityId: params.entityId, err: error });
    return null;
  }
}

export interface AuditActor {
  id: string;
  fullName: string;
  email: string;
}

const idOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** "Full Name (email@x.y)": what an administrator recognises. Falls back to whichever of the two exists. */
const describePerson = (person: { fullName?: string | null; email?: string | null }): string | null => {
  const name = person.fullName?.trim();
  const email = person.email?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || null;
};

/**
 * AuditLog has no relation to User (entries must outlive deleted accounts), so the people an entry names are resolved
 * with ONE batched lookup for the whole page:
 *  - `user`: who did it (userId);
 *  - `entityLabel`: for entries about a USER, who it was done to, as "Full Name (email)". It is null for every other
 *    entity type (those carry no readable name here) and for a user that no longer exists, so the UI can fall back to
 *    the raw id. Only the name and e-mail are ever read.
 * Best-effort: a failed lookup leaves `user` and `entityLabel` null rather than failing the page.
 */
async function attachPeople<T extends { userId?: string | null; entityType?: string | null; entityId?: string | null }>(
  logs: T[]
): Promise<Array<T & { user: AuditActor | null; entityLabel: string | null }>> {
  const targetOf = (entry: T) => (entry.entityType === 'USER' ? idOrNull(entry.entityId) : null);

  const wanted = new Set<string>();
  for (const entry of logs) {
    const actorId = idOrNull(entry.userId);
    if (actorId) wanted.add(actorId);
  }
  for (const entry of logs) {
    const targetId = targetOf(entry);
    if (targetId) wanted.add(targetId);
  }

  const byId = new Map<string, AuditActor>();
  if (wanted.size > 0) {
    try {
      const users = (await prisma.user.findMany({
        where: { id: { in: Array.from(wanted) } },
        select: { id: true, fullName: true, email: true },
      })) || [];
      for (const user of users) byId.set(user.id, user);
    } catch (error) {
      log.error('Failed to resolve the people named in audit log entries', { err: error });
    }
  }

  return logs.map((entry) => {
    const actorId = idOrNull(entry.userId);
    const targetId = targetOf(entry);
    const target = targetId ? byId.get(targetId) : undefined;
    return {
      ...entry,
      user: (actorId && byId.get(actorId)) || null,
      entityLabel: target ? describePerson(target) : null,
    };
  });
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
    logs: await attachPeople(logs),
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
