import { Request, Response, NextFunction } from 'express';
import { jobService } from '../services/jobService';
import { logAuditAction } from '../services/auditService';

export class JobController {
  async getJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = {
        ...req.query,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 12,
      };
      const result = await jobService.getJobs(filters);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await jobService.getJob(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createJob(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await jobService.createJob(req.user!.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await jobService.updateJob(req.user!.id, id, req.body, isAdmin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await jobService.deleteJob(req.user!.id, id, isAdmin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async approveJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await jobService.approveJob(id);
      
      // Audit log (non-blocking - don't fail request if audit fails)
      logAuditAction({
        userId: req.user!.id,
        action: 'APPROVE',
        entityType: 'JOB',
        entityId: id,
        newValues: { status: 'APPROVED' },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(err => console.error('Audit log failed:', err));
      
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async rejectJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const result = await jobService.rejectJob(id, reason);
      
      // Audit log (non-blocking - don't fail request if audit fails)
      logAuditAction({
        userId: req.user!.id,
        action: 'REJECT',
        entityType: 'JOB',
        entityId: id,
        newValues: { status: 'REJECTED', reason },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }).catch(err => console.error('Audit log failed:', err));
      
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await jobService.getMyJobs(req.user!.id, page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const jobController = new JobController();
