import { Request, Response } from 'express';
import {
  getAuditLogs,
  getEntityAuditHistory,
  getRecentAdminActivity,
  deleteOldAuditLogs,
  AuditEntityType,
  AuditAction,
} from '../services/auditService';

export const auditController = {
  /**
   * Get paginated audit logs with optional filters (Admin only)
   */
  async getLogs(req: Request, res: Response) {
    try {
      const {
        userId,
        entityType,
        action,
        entityId,
        startDate,
        endDate,
        page = '1',
        limit = '50',
      } = req.query;

      const result = await getAuditLogs({
        userId: userId as string | undefined,
        entityType: entityType as AuditEntityType | undefined,
        action: action as AuditAction | undefined,
        entityId: entityId as string | undefined,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined,
        page: parseInt(page as string, 10),
        limit: Math.min(parseInt(limit as string, 10), 100), // Max 100 per page
      });

      res.json(result);
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  },

  /**
   * Get audit history for a specific entity
   */
  async getEntityHistory(req: Request, res: Response) {
    try {
      const { entityType, entityId } = req.params;

      if (!entityType || !entityId) {
        return res.status(400).json({ error: 'entityType and entityId are required' });
      }

      const logs = await getEntityAuditHistory(
        entityType as AuditEntityType,
        entityId
      );

      res.json({ logs });
    } catch (error) {
      console.error('Error fetching entity audit history:', error);
      res.status(500).json({ error: 'Failed to fetch audit history' });
    }
  },

  /**
   * Get recent admin activity
   */
  async getRecentActivity(req: Request, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const logs = await getRecentAdminActivity(Math.min(limit, 50));

      res.json({ logs });
    } catch (error) {
      console.error('Error fetching recent admin activity:', error);
      res.status(500).json({ error: 'Failed to fetch admin activity' });
    }
  },

  /**
   * Cleanup old audit logs (Super Admin only)
   */
  async cleanupOldLogs(req: Request, res: Response) {
    try {
      const daysToKeep = parseInt(req.body.daysToKeep as string, 10) || 365;
      const deletedCount = await deleteOldAuditLogs(daysToKeep);

      res.json({
        message: `Successfully deleted ${deletedCount} old audit logs`,
        deletedCount,
      });
    } catch (error) {
      console.error('Error cleaning up audit logs:', error);
      res.status(500).json({ error: 'Failed to cleanup audit logs' });
    }
  },
};
