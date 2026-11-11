import { Request, Response, NextFunction } from 'express';
import { getSystemStatus } from '../services/systemStatusService';

export const systemStatusController = {
  /**
   * What the platform depends on and whether it is working, in plain words (Admin only).
   * A failing check shows up as an "error" line in the report; it never turns the call into a 500.
   */
  async get(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ success: true, data: await getSystemStatus() });
    } catch (error) {
      next(error);
    }
  },
};
