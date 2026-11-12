import { Request, Response, NextFunction } from 'express';
import { alumniRecordService } from '../services/alumniRecordService';
import { queryText } from '../utils/inputGuards';

const actorOf = (req: Request) => ({ id: req.user!.id });
const metaOf = (req: Request) => ({ ipAddress: req.ip, userAgent: req.headers['user-agent'] });

/**
 * The college alumni list (admin and above, enforced by the routes). The rows are personal data of people who have not
 * registered: they are never logged here, and the answer to an import carries counts and row numbers only.
 */
export const alumniRecordController = {
  async importRows(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await alumniRecordService.importRows(actorOf(req), req.body?.rows, metaOf(req));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await alumniRecordService.list({
        search: queryText(req.query.search),
        page: queryText(req.query.page),
        limit: queryText(req.query.limit),
      });
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await alumniRecordService.remove(actorOf(req), req.params.id, metaOf(req));
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
