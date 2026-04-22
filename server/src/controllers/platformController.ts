import { Request, Response, NextFunction } from 'express';
import { moduleReadiness } from '../config/platformReadiness';

export const platformController = {
  async getReadiness(_req: Request, res: Response, next: NextFunction) {
    try {
      const summary = moduleReadiness.reduce(
        (acc, module) => {
          if (module.status === 'IMPLEMENTED') acc.implemented += 1;
          if (module.status === 'PARTIAL') acc.partial += 1;
          if (module.status === 'PLANNED') acc.planned += 1;
          return acc;
        },
        { implemented: 0, partial: 0, planned: 0 }
      );

      res.json({
        success: true,
        data: {
          version: '2026.04',
          generatedAt: new Date().toISOString(),
          summary,
          modules: moduleReadiness,
        },
      });
    } catch (error) {
      next(error);
    }
  },
};

