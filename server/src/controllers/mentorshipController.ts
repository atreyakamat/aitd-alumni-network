import { Request, Response, NextFunction } from 'express';
import { mentorshipService } from '../services/mentorshipService';

export class MentorshipController {
  // ============== MENTOR PROFILES ==============

  async getMentors(req: Request, res: Response, next: NextFunction) {
    try {
      const { page = 1, limit = 20, focusArea, search, available } = req.query;
      const result = await mentorshipService.getMentors(
        Number(page),
        Number(limit),
        {
          focusArea: focusArea as string,
          search: search as string,
          available: available === 'true',
        }
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMentorProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const result = await mentorshipService.getMentorProfile(userId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyMentorProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await mentorshipService.getMentorProfile(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createMentorProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await mentorshipService.createMentorProfile(req.user!.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateMentorProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await mentorshipService.updateMentorProfile(req.user!.id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteMentorProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await mentorshipService.deleteMentorProfile(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ============== MENTORSHIP REQUESTS ==============

  async requestMentorship(req: Request, res: Response, next: NextFunction) {
    try {
      const { mentorId } = req.params;
      const result = await mentorshipService.requestMentorship(
        req.user!.id,
        mentorId,
        req.body
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async respondToRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { requestId } = req.params;
      const { accept } = req.body;
      const result = await mentorshipService.respondToRequest(
        req.user!.id,
        requestId,
        accept
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyMentorRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.query;
      const result = await mentorshipService.getMyMentorshipRequests(
        req.user!.id,
        'mentor',
        status as string
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyMenteeRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { status } = req.query;
      const result = await mentorshipService.getMyMentorshipRequests(
        req.user!.id,
        'mentee',
        status as string
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // ============== SESSIONS ==============

  async scheduleSession(req: Request, res: Response, next: NextFunction) {
    try {
      const { requestId } = req.params;
      const result = await mentorshipService.scheduleSession(
        req.user!.id,
        requestId,
        req.body
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async completeSession(req: Request, res: Response, next: NextFunction) {
    try {
      const { sessionId } = req.params;
      const { outcomes } = req.body;
      const result = await mentorshipService.completeSession(
        req.user!.id,
        sessionId,
        outcomes
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const { requestId } = req.params;
      const result = await mentorshipService.getMentorshipSessions(
        requestId,
        req.user!.id
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async endMentorship(req: Request, res: Response, next: NextFunction) {
    try {
      const { requestId } = req.params;
      const result = await mentorshipService.endMentorship(req.user!.id, requestId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const mentorshipController = new MentorshipController();
