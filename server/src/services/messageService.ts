import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { networkService } from './networkService';
import { notificationService } from './notificationService';
import { emitToUser } from '../utils/socket';
import { clientLinks } from '../utils/clientLinks';

export const MESSAGE_MAX_LENGTH = 5000;

interface SendMessageInput {
  content: string;
  mediaUrl?: string;
}

const participantSelect = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
} as const;

export class MessageService {
  async getConversations(userId: string, page: number = 1, limit: number = 20) {
    const { skip, take, page: safePage, limit: safeLimit } = paginationHelper(page, limit);

    // Latest-first list of every message the user is part of
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
      },
      include: {
        sender: { select: participantSelect },
        receiver: { select: participantSelect },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by conversation partner, keeping the latest message
    const conversationMap = new Map<string, typeof messages[0]>();
    for (const msg of messages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      if (!conversationMap.has(partnerId)) {
        conversationMap.set(partnerId, msg);
      }
    }

    const page_ = Array.from(conversationMap.entries()).slice(skip, skip + take);

    // One grouped query for unread counts instead of one count per conversation
    const unreadByPartner = new Map<string, number>();
    if (page_.length > 0) {
      const grouped = await prisma.message.groupBy({
        by: ['senderId'],
        where: {
          receiverId: userId,
          isRead: false,
          senderId: { in: page_.map(([partnerId]) => partnerId) },
        },
        _count: { _all: true },
      });
      for (const row of grouped || []) {
        unreadByPartner.set(row.senderId, row._count?._all ?? 0);
      }
    }

    const conversations = page_.map(([partnerId, lastMessage]) => ({
      partnerId,
      partner: lastMessage.senderId === userId ? lastMessage.receiver : lastMessage.sender,
      lastMessage: {
        id: lastMessage.id,
        content: lastMessage.content,
        createdAt: lastMessage.createdAt,
        isRead: lastMessage.isRead,
        isSent: lastMessage.senderId === userId,
        isRequest: lastMessage.isRequest,
        requestStatus: lastMessage.requestStatus,
      },
      unreadCount: unreadByPartner.get(partnerId) ?? 0,
    }));

    return buildPaginationResponse(conversations, conversationMap.size, safePage, safeLimit);
  }

  async getMessages(userId: string, partnerId: string, page: number = 1, limit: number = 50) {
    const { skip, take, page: safePage, limit: safeLimit } = paginationHelper(page, limit);

    // Strictly the two-party thread between the caller and the partner
    const where = {
      OR: [
        { senderId: userId, receiverId: partnerId },
        { senderId: partnerId, receiverId: userId },
      ],
    };

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          sender: { select: participantSelect },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.message.count({ where }),
    ]);

    // Opening the thread reads everything the partner sent to the caller
    await this.markAllAsRead(userId, partnerId);

    return buildPaginationResponse([...messages].reverse(), total, safePage, safeLimit);
  }

  async sendMessage(senderId: string, receiverId: string, data: SendMessageInput) {
    if (!receiverId || senderId === receiverId) {
      throw new AppError('Cannot send message to yourself', 400, 'INVALID_REQUEST');
    }

    const raw = data?.content;
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new AppError('Message content is required', 400, 'VALIDATION_ERROR');
    }
    const content = raw.trim();
    if (content.length > MESSAGE_MAX_LENGTH) {
      throw new AppError(`Message must be at most ${MESSAGE_MAX_LENGTH} characters`, 400, 'VALIDATION_ERROR');
    }
    if (data.mediaUrl !== undefined && data.mediaUrl !== null && typeof data.mediaUrl !== 'string') {
      throw new AppError('mediaUrl must be a string', 400, 'VALIDATION_ERROR');
    }

    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, isActive: true },
    });
    if (!receiver || !receiver.isActive) {
      throw new AppError('Recipient not found', 404, 'NOT_FOUND');
    }

    const isRequest = !(await this.canMessageDirectly(senderId, receiverId));

    if (isRequest) {
      // Non-connections get exactly one outstanding request until the receiver accepts it
      const existingRequest = await prisma.message.findFirst({
        where: {
          senderId,
          receiverId,
          isRequest: true,
          requestStatus: { in: ['PENDING', 'DECLINED'] },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingRequest?.requestStatus === 'PENDING') {
        throw new AppError('You already have a pending message request', 409, 'REQUEST_PENDING');
      }
      if (existingRequest?.requestStatus === 'DECLINED') {
        throw new AppError('This user declined your message request', 403, 'REQUEST_DECLINED');
      }
    }

    const message = await prisma.message.create({
      data: {
        senderId,
        receiverId,
        content,
        mediaUrl: data.mediaUrl || null,
        isRequest,
        requestStatus: isRequest ? 'PENDING' : null,
      },
      include: {
        sender: { select: participantSelect },
      },
    });

    // Emit real-time message
    emitToUser(receiverId, 'new_message', message);

    // Create notification
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { fullName: true },
    });

    await notificationService.createNotification({
      userId: receiverId,
      type: 'MESSAGE_RECEIVED',
      title: isRequest ? 'New Message Request' : 'New Message',
      message: `${sender?.fullName ?? 'Someone'} sent you a message`,
      link: clientLinks.conversation(senderId),
      metadata: { messageId: message.id, senderId },
    });

    return message;
  }

  /**
   * Two users may message freely when connected, or once either side has
   * accepted a message request from the other. Replying to a pending request
   * from the receiver implicitly accepts it.
   */
  private async canMessageDirectly(senderId: string, receiverId: string): Promise<boolean> {
    if (await networkService.areConnected(senderId, receiverId)) return true;

    const accepted = await prisma.message.findFirst({
      where: {
        isRequest: true,
        requestStatus: 'ACCEPTED',
        OR: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      },
      select: { id: true },
    });
    if (accepted) return true;

    const replied = await prisma.message.updateMany({
      where: {
        senderId: receiverId,
        receiverId: senderId,
        isRequest: true,
        requestStatus: 'PENDING',
      },
      data: { requestStatus: 'ACCEPTED' },
    });
    return !!replied && replied.count > 0;
  }

  async respondToMessageRequest(userId: string, messageId: string, accept: boolean) {
    if (typeof accept !== 'boolean') {
      throw new AppError('accept must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new AppError('Message not found', 404, 'NOT_FOUND');
    }

    if (message.receiverId !== userId) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    if (!message.isRequest || message.requestStatus !== 'PENDING') {
      throw new AppError('This is not a pending message request', 400, 'INVALID_REQUEST');
    }

    await prisma.message.update({
      where: { id: messageId },
      // A declined request is dismissed, so it must not linger in the unread count
      data: accept
        ? { requestStatus: 'ACCEPTED' }
        : { requestStatus: 'DECLINED', isRead: true, readAt: new Date() },
    });

    if (accept) {
      const receiver = await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });

      await notificationService.createNotification({
        userId: message.senderId,
        type: 'MESSAGE_RECEIVED',
        title: 'Message Request Accepted',
        message: `${receiver?.fullName ?? 'Someone'} accepted your message request`,
        link: clientLinks.conversation(userId),
        metadata: { messageId, receiverId: userId },
      });
    }

    return { message: accept ? 'Message request accepted' : 'Message request declined' };
  }

  async getUnreadCount(userId: string) {
    const count = await prisma.message.count({
      where: {
        receiverId: userId,
        isRead: false,
      },
    });

    return { unreadCount: count };
  }

  async markAllAsRead(userId: string, partnerId: string) {
    // Only ever touches messages the caller received from this partner
    const result = await prisma.message.updateMany({
      where: {
        senderId: partnerId,
        receiverId: userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    const updated = result?.count ?? 0;
    if (updated > 0) {
      emitToUser(partnerId, 'messages_read', { readerId: userId, count: updated });
    }

    return { message: 'Messages marked as read', updated };
  }
}

export const messageService = new MessageService();
