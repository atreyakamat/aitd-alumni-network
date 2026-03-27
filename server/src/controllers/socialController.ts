import { Request, Response, NextFunction } from 'express';
import { networkService } from '../services/networkService';
import { messageService } from '../services/messageService';
import { notificationService } from '../services/notificationService';

// Network Controller
export class NetworkController {
  async getConnections(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await networkService.getConnections(req.user!.id, page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getPendingRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await networkService.getPendingRequests(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async sendRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const result = await networkService.sendConnectionRequest(req.user!.id, userId);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async respondToRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { accept } = req.body;
      const result = await networkService.respondToRequest(req.user!.id, id, accept);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async removeConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await networkService.removeConnection(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getSuggestions(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const result = await networkService.getSuggestions(req.user!.id, limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

// Message Controller
export class MessageController {
  async getConversations(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await messageService.getConversations(req.user!.id, page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getMessages(req: Request, res: Response, next: NextFunction) {
    try {
      const { partnerId } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const result = await messageService.getMessages(req.user!.id, partnerId, page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async sendMessage(req: Request, res: Response, next: NextFunction) {
    try {
      const { receiverId } = req.params;
      const result = await messageService.sendMessage(req.user!.id, receiverId, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async respondToRequest(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { accept } = req.body;
      const result = await messageService.respondToMessageRequest(req.user!.id, id, accept);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getUnreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await messageService.getUnreadCount(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { partnerId } = req.params;
      const result = await messageService.markAllAsRead(req.user!.id, partnerId);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

// Notification Controller
export class NotificationController {
  async getNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const unreadOnly = req.query.unread === 'true';
      const result = await notificationService.getNotifications(req.user!.id, page, limit, unreadOnly);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getUnreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await notificationService.getUnreadCount(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await notificationService.markAsRead(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await notificationService.markAllAsRead(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteNotification(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await notificationService.deleteNotification(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const networkController = new NetworkController();
export const messageController = new MessageController();
export const notificationController = new NotificationController();
