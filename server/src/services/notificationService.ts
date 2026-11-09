import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { Notification, NotificationType } from '@prisma/client';
import { publishNotificationEvent } from './notificationBus';

export class NotificationService {
  async getNotifications(userId: string, page: number = 1, limit: number = 20, unreadOnly: boolean = false) {
    const { skip, take, page: safePage, limit: safeLimit } = paginationHelper(page, limit);

    const where = {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({ where }),
    ]);

    return buildPaginationResponse(notifications, total, safePage, safeLimit);
  }

  async getUnreadCount(userId: string) {
    const count = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { unreadCount: count };
  }

  async markAsRead(userId: string, notificationId: string) {
    // Scoped by userId so users can only touch their own notifications.
    const { count } = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });

    if (count === 0) {
      throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
    }

    return { message: 'Notification marked as read' };
  }

  async markAllAsRead(userId: string) {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return { message: 'All notifications marked as read' };
  }

  async deleteNotification(userId: string, notificationId: string) {
    const { count } = await prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });

    if (count === 0) {
      throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
    }

    return { message: 'Notification deleted' };
  }

  /**
   * Creates a notification for one member. It goes through the notification bus: with Kafka configured the consumer stores it
   * and nudges the member (the call then returns undefined); otherwise it is stored here and the stored row is returned.
   */
  async createNotification(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: any;
  }): Promise<Notification | undefined> {
    const stored = await publishNotificationEvent('notification.deliver', {
      userId: data.userId,
      type: data.type,
      title: data.title,
      message: data.message,
      link: data.link,
      metadata: data.metadata,
    });
    return stored as Notification | undefined;
  }
}

export const notificationService = new NotificationService();
