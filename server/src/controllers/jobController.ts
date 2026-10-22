import { Request, Response, NextFunction } from 'express';
import { jobService, JobFilters } from '../services/jobService';
import { logAuditAction } from '../services/auditService';
import { isAdminRole } from '../config/permissions';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const int = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
};

/** Whitelist query params; accepts the client's `type`/`search` aliases. */
export const parseJobFilters = (query: Request['query']): JobFilters => ({
  jobType: str(query.jobType) ?? str(query.type),
  workplaceType: str(query.workplaceType),
  location: str(query.location),
  industry: str(query.industry),
  skills: str(query.skills),
  experience: int(query.experience),
  search: str(query.search) ?? str(query.keyword) ?? str(query.q),
  page: int(query.page) ?? 1,
  limit: int(query.limit) ?? 12,
});

export class JobController {
  async getJobs(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await jobService.getJobs(parseJobFilters(req.query));
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const viewer = req.user ? { id: req.user.id, userRole: req.user.userRole } : null;
      const result = await jobService.getJob(id, viewer);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createJob(req: Request, res: Response, next: NextFunction) {
    try {
      const isAdmin = isAdminRole(req.user!.userRole);
      const result = await jobService.createJob(req.user!.id, req.body, isAdmin);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = isAdminRole(req.user!.userRole);
      const result = await jobService.updateJob(req.user!.id, id, req.body, isAdmin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteJob(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = isAdminRole(req.user!.userRole);
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
        oldValues: { status: 'PENDING_REVIEW' },
        newValues: { status: 'PUBLISHED' },
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
      const { reason } = req.body || {};
      const result = await jobService.rejectJob(id, reason);

      // Audit log (non-blocking - don't fail request if audit fails)
      logAuditAction({
        userId: req.user!.id,
        action: 'REJECT',
        entityType: 'JOB',
        entityId: id,
        oldValues: { status: 'PENDING_REVIEW' },
        newValues: { status: 'REJECTED', reason: result.rejectionReason },
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
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 10;
      const result = await jobService.getMyJobs(req.user!.id, page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }
}

export const jobController = new JobController();
