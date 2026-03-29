import prisma from '../config/database';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { NotificationType } from '@prisma/client';
import { emitToUser } from '../utils/socket';

export class NotificationService {
  async getNotifications(userId: string, page: number = 1, limit: number = 20, unreadOnly: boolean = false) {
    const { skip, take } = paginationHelper(page, limit);

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

    return buildPaginationResponse(notifications, total, page, limit);
  }

  async getUnreadCount(userId: string) {
    const count = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    return { unreadCount: count };
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true },
    });

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
    await prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });

    return { message: 'Notification deleted' };
  }

  /**
   * Internal helper to create and emit notification
   */
  async createNotification(data: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    link?: string;
    metadata?: any;
  }) {
    const notification = await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link,
        metadata: data.metadata,
      },
    });

    // Emit real-time notification
    emitToUser(data.userId, 'new_notification', notification);

    return notification;
  }
}

export const notificationService = new NotificationService();
