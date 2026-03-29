import { Request, Response, NextFunction } from 'express';
import { inviteService } from '../services/inviteService';
import { AppError } from '../middleware/errorHandler';

export class InviteController {
  // Send a single invite
  async sendInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, name, batchYear, message } = req.body;

      if (!email) {
        throw new AppError('Email is required', 400, 'MISSING_EMAIL');
      }

      const result = await inviteService.sendInvite(req.user!.id, {
        email,
        name,
        batchYear: batchYear ? parseInt(batchYear) : undefined,
        message,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
        });
      }

      res.status(201).json({
        success: true,
        message: 'Invitation sent successfully',
        data: result.invite,
      });
    } catch (error) {
      next(error);
    }
  }

  // Send bulk invites (CSV upload)
  async sendBulkInvites(req: Request, res: Response, next: NextFunction) {
    try {
      const { invites } = req.body;

      if (!Array.isArray(invites) || invites.length === 0) {
        throw new AppError('Invites array is required', 400, 'MISSING_INVITES');
      }

      if (invites.length > 100) {
        throw new AppError('Maximum 100 invites per batch', 400, 'TOO_MANY_INVITES');
      }

      const result = await inviteService.sendBulkInvites(req.user!.id, invites);

      res.json({
        success: true,
        message: `Sent ${result.sent} of ${result.total} invitations`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  // Verify invite token (for registration page)
  async verifyInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { token } = req.params;

      const invite = await inviteService.verifyInvite(token);

      res.json({
        success: true,
        data: invite,
      });
    } catch (error) {
      next(error);
    }
  }

  // Accept invite (called during registration)
  async acceptInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { token } = req.params;

      if (!req.user) {
        throw new AppError('Authentication required', 401, 'UNAUTHENTICATED');
      }

      const result = await inviteService.acceptInvite(token, req.user.id);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get sent invites
  async getSentInvites(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      const result = await inviteService.getSentInvites(req.user!.id, page, limit);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  // Get invite stats
  async getInviteStats(req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await inviteService.getInviteStats(req.user!.id);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  // Generate shareable link
  async generateShareableLink(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await inviteService.generateShareableLink(req.user!.id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

export const inviteController = new InviteController();
