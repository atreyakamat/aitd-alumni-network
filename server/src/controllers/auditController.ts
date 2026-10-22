import { Request, Response, NextFunction } from 'express';
import {
  getAuditLogs,
  getEntityAuditHistory,
  getRecentAdminActivity,
  deleteOldAuditLogs,
  logAuditAction,
  AuditEntityType,
  AuditAction,
  DEFAULT_AUDIT_RETENTION_DAYS,
} from '../services/auditService';
import { AppError } from '../middleware/errorHandler';

const toInt = (value: unknown, fallback: number) => {
  const parsed = parseInt(value as string, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseDate = (value: unknown, field: string): Date | undefined => {
  if (value === undefined || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError(`${field} must be a valid date`, 400, 'VALIDATION_ERROR');
  }
  return date;
};

const optionalString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

export const auditController = {
  /**
   * Get paginated audit logs with optional filters (Admin only)
   */
  async getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, entityType, action, entityId, startDate, endDate } = req.query;

      const result = await getAuditLogs({
        userId: optionalString(userId),
        entityType: optionalString(entityType) as AuditEntityType | undefined,
        action: optionalString(action) as AuditAction | undefined,
        entityId: optionalString(entityId),
        startDate: parseDate(startDate, 'startDate'),
        endDate: parseDate(endDate, 'endDate'),
        page: toInt(req.query.page, 1),
        limit: Math.min(toInt(req.query.limit, 50), 100), // Max 100 per page
      });

      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get audit history for a specific entity
   */
  async getEntityHistory(req: Request, res: Response, next: NextFunction) {
    try {
      const { entityType, entityId } = req.params;

      if (!entityType || !entityId) {
        throw new AppError('entityType and entityId are required', 400, 'VALIDATION_ERROR');
      }

      const logs = await getEntityAuditHistory(entityType as AuditEntityType, entityId);
      res.json({ success: true, logs });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Get recent admin activity
   */
  async getRecentActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = toInt(req.query.limit, 20);
      const logs = await getRecentAdminActivity(Math.min(limit, 50));
      res.json({ success: true, logs });
    } catch (error) {
      next(error);
    }
  },

  /**
   * Cleanup old audit logs (Super Admin only). Retention below 30 days is rejected.
   */
  async cleanupOldLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = req.body?.daysToKeep;
      const daysToKeep = raw === undefined || raw === null || raw === '' ? DEFAULT_AUDIT_RETENTION_DAYS : Number(raw);
      if (!Number.isFinite(daysToKeep)) {
        throw new AppError('daysToKeep must be a number', 400, 'VALIDATION_ERROR');
      }

      const deletedCount = await deleteOldAuditLogs(daysToKeep);

      await logAuditAction({
        userId: req.user?.id,
        action: 'DELETE',
        entityType: 'SYSTEM',
        entityId: 'audit-logs',
        newValues: { daysToKeep, deletedCount },
        ipAddress: req.ip,
      });

      res.json({
        success: true,
        message: `Successfully deleted ${deletedCount} old audit logs`,
        deletedCount,
      });
    } catch (error) {
      next(error);
    }
  },
};
