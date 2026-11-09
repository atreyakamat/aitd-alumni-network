import { Request, Response, NextFunction } from 'express';
import { memberApprovalService } from '../services/memberApprovalService';
import { queryText } from '../utils/inputGuards';

const actorOf = (req: Request) => ({ id: req.user!.id, userRole: req.user!.userRole });
const metaOf = (req: Request) => ({ ipAddress: req.ip, userAgent: req.headers['user-agent'] });

/** Alumni approval: the administrator's review queue (admin and above, enforced by the route). */
export const memberApprovalController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await memberApprovalService.list({
        status: queryText(req.query.status),
        search: queryText(req.query.search),
        page: queryText(req.query.page),
        limit: queryText(req.query.limit),
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },

  async summary(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await memberApprovalService.summary() });
    } catch (error) {
      next(error);
    }
  },

  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await memberApprovalService.approve(actorOf(req), req.params.id, req.body?.note, metaOf(req));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await memberApprovalService.reject(actorOf(req), req.params.id, req.body?.reason, metaOf(req));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
