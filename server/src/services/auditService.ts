import prisma from '../config/database';
import { Prisma } from '@prisma/client';

export type AuditAction = 
  | 'CREATE' 
  | 'UPDATE' 
  | 'DELETE' 
  | 'APPROVE' 
  | 'REJECT' 
  | 'ACTIVATE' 
  | 'DEACTIVATE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'PASSWORD_CHANGE'
  | 'ROLE_CHANGE'
  | 'BULK_INVITE'
  | 'EXPORT_DATA';

export type AuditEntityType = 
  | 'USER'
  | 'POST'
  | 'JOB'
  | 'EVENT'
  | 'NEWS'
  | 'MEMBERSHIP'
  | 'DONATION'
  | 'CHAPTER'
  | 'GALLERY'
  | 'MARKETPLACE_ITEM'
  | 'INVITATION'
  | 'MENTORSHIP'
  | 'SYSTEM';

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
  const {
    userId,
    entityType,
    action,
    entityId,
    startDate,
    endDate,
    page = 1,
    limit = 50,
  } = options;

  const where: Record<string, unknown> = {};

  if (userId) where.userId = userId;
  if (entityType) where.entityType = entityType;
  if (action) where.action = action;
  if (entityId) where.entityId = entityId;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) (where.createdAt as Record<string, Date>).gte = startDate;
    if (endDate) (where.createdAt as Record<string, Date>).lte = endDate;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
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
  });
}

/**
 * Get recent admin activity
 */
export async function getRecentAdminActivity(limit = 20) {
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
export async function deleteOldAuditLogs(daysToKeep = 365) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  const result = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate },
    },
  });

  return result.count;
}
