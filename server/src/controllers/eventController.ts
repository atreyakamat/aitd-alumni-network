import { Request, Response, NextFunction } from 'express';
import { eventService } from '../services/eventService';

export class EventController {
  async getEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = {
        ...req.query,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 12,
      };
      const result = await eventService.getEvents(filters);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await eventService.getEvent(id, req.user?.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await eventService.createEvent(req.user!.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await eventService.updateEvent(req.user!.id, id, req.body, isAdmin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await eventService.deleteEvent(req.user!.id, id, isAdmin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async rsvpEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await eventService.rsvpEvent(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getUpcomingEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const result = await eventService.getUpcomingEvents(limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getEventAttendees(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await eventService.getEventAttendees(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const eventController = new EventController();
