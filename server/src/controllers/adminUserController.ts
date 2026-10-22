import { Request, Response, NextFunction } from 'express';
import { adminService, RequestMeta } from '../services/adminService';
import { privacyService } from '../services/privacyService';
import { transactionService } from '../services/transactionService';
import { chapterService } from '../services/chapterService';
import { logAuditAction } from '../services/auditService';

const requestMeta = (req: Request): RequestMeta => ({
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

const actorOf = (req: Request) => ({ id: req.user!.id, userRole: req.user!.userRole });

/**
 * Admin user management, moderation queues and exports (PRD §6.10, §12.3).
 */
export const adminUserController = {
  async listUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, role, isActive, batchYear, page, limit } = req.query as Record<string, string>;
      const result = await adminService.listUsers({
        search,
        role,
        isActive,
        batchYear,
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit, 10) || 20,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },

  async updateUserRole(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.updateUserRole(actorOf(req), req.params.id, req.body?.role, requestMeta(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async updateUserStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { isActive, reason } = req.body || {};
      const result = await adminService.updateUserStatus(actorOf(req), req.params.id, isActive, reason, requestMeta(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getPendingJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(100, parseInt(req.query.limit as string, 10) || 20);
      const result = await adminService.getPendingJobs(page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },

  async getMentorshipOverview(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await adminService.getMentorshipOverview();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async exportEntity(req: Request, res: Response, next: NextFunction) {
    try {
      const { filename, csv } = await adminService.exportEntity(actorOf(req), req.params.entity, requestMeta(req));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      next(error);
    }
  },

  async assignChapterAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await chapterService.assignAdmin(req.params.id, req.body?.userId);
      await logAuditAction({
        userId: req.user!.id,
        action: 'UPDATE',
        entityType: 'CHAPTER',
        entityId: req.params.id,
        newValues: { adminUserId: req.body?.userId },
        ...requestMeta(req),
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
};

/**
 * Self-service account endpoints (PRD §6.8, §8.5).
 */
export const accountController = {
  async exportMyData(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await privacyService.exportMyData(req.user!.id, requestMeta(req));
      res.setHeader('Content-Disposition', `attachment; filename="aitd-connection-data-${data.exportedAt.slice(0, 10)}.json"`);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async deleteMyAccount(req: Request, res: Response, next: NextFunction) {
    try {
      const { password, confirm } = req.body || {};
      const result = await privacyService.deleteMyAccount(req.user!.id, { password, confirm }, requestMeta(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getMyTransactions(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, status } = req.query as Record<string, string>;
      const result = await transactionService.getMyTransactions(req.user!.id, {
        type,
        status,
        page: parseInt(req.query.page as string, 10) || 1,
        limit: Math.min(100, parseInt(req.query.limit as string, 10) || 20),
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },
};
