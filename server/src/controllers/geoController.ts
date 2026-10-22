import { Request, Response, NextFunction } from 'express';
import { geocodingService } from '../services/geocodingService';

const parseCoordinate = (value: unknown, max: number): number | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : undefined;
};

export class GeoController {
  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q) {
        return res.status(400).json({ success: false, message: 'q (place name) is required.' });
      }
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      const data = await geocodingService.search(q, Number.isNaN(limit) ? undefined : limit);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }

  async reverse(req: Request, res: Response, next: NextFunction) {
    try {
      const lat = parseCoordinate(req.query.lat, 90);
      const lng = parseCoordinate(req.query.lng, 180);
      if (lat === undefined || lng === undefined) {
        return res.status(400).json({
          success: false,
          message: 'lat (-90..90) and lng (-180..180) are required.',
        });
      }
      const data = await geocodingService.reverse(lat, lng);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
}

export const geoController = new GeoController();
