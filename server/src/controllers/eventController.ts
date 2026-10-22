import { Request, Response, NextFunction } from 'express';
import { eventService, EventFilters } from '../services/eventService';
import { isAdminRole, Actor } from '../config/permissions';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const int = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
};

/** Whitelist query params; accepts the client's `type` alias and parses `upcoming` as a boolean. */
export const parseEventFilters = (query: Request['query']): EventFilters => ({
  eventType: str(query.eventType) ?? str(query.type),
  city: str(query.city),
  chapterId: str(query.chapterId),
  upcoming: query.upcoming === 'true' || query.upcoming === '1',
  search: str(query.search) ?? str(query.q),
  page: int(query.page) ?? 1,
  limit: int(query.limit) ?? 12,
});

const viewerOf = (req: Request): Actor | null =>
  req.user ? { id: req.user.id, userRole: req.user.userRole } : null;

export class EventController {
  async getEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await eventService.getEvents(parseEventFilters(req.query), viewerOf(req));
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await eventService.getEvent(id, viewerOf(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await eventService.createEvent(req.user!.id, req.body, req.user!.userRole!);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = isAdminRole(req.user!.userRole);
      const result = await eventService.updateEvent(req.user!.id, id, req.body, isAdmin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteEvent(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = isAdminRole(req.user!.userRole);
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
      const limit = parseInt(req.query.limit as string, 10) || 5;
      const result = await eventService.getUpcomingEvents(limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getEventAttendees(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await eventService.getEventAttendees(id, viewerOf(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const eventController = new EventController();
