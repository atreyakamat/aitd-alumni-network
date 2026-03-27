import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { networkService } from './networkService';

interface SendMessageInput {
  content: string;
  mediaUrl?: string;
}

export class MessageService {
  async getConversations(userId: string, page: number = 1, limit: number = 20) {
    // Get all unique conversations
    const { skip, take } = paginationHelper(page, limit);

    // Get the latest message from each conversation
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: userId },
          { receiverId: userId },
        ],
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
        receiver: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by conversation partner and get latest message
    const conversationMap = new Map<string, typeof messages[0]>();
    
    for (const msg of messages) {
      const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
      
      if (!conversationMap.has(partnerId)) {
        conversationMap.set(partnerId, msg);
      }
    }

    const conversations = Array.from(conversationMap.entries())
      .slice(skip, skip + take)
      .map(([partnerId, lastMessage]) => {
        const partner = lastMessage.senderId === userId 
          ? lastMessage.receiver 
          : lastMessage.sender;
        
        return {
          partnerId,
          partner,
          lastMessage: {
            id: lastMessage.id,
            content: lastMessage.content,
            createdAt: lastMessage.createdAt,
            isRead: lastMessage.isRead,
            isSent: lastMessage.senderId === userId,
          },
          unreadCount: 0, // Will be calculated separately
        };
      });

    // Get unread counts
    for (const conv of conversations) {
      conv.unreadCount = await prisma.message.count({
        where: {
          senderId: conv.partnerId,
          receiverId: userId,
          isRead: false,
        },
      });
    }

    return {
      data: conversations,
      pagination: {
        total: conversationMap.size,
        page,
        limit,
        totalPages: Math.ceil(conversationMap.size / limit),
        hasNextPage: page * limit < conversationMap.size,
        hasPrevPage: page > 1,
      },
    };
  }

  async getMessages(userId: string, partnerId: string, page: number = 1, limit: number = 50) {
    const { skip, take } = paginationHelper(page, limit);

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, receiverId: partnerId },
            { senderId: partnerId, receiverId: userId },
          ],
        },
        include: {
          sender: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.message.count({
        where: {
          OR: [
            { senderId: userId, receiverId: partnerId },
            { senderId: partnerId, receiverId: userId },
          ],
        },
      }),
    ]);

    // Mark messages as read
    await prisma.message.updateMany({
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

    return buildPaginationResponse(messages.reverse(), total, page, limit);
  }

  async sendMessage(senderId: string, receiverId: string, data: SendMessageInput) {
    if (senderId === receiverId) {
      throw new AppError('Cannot send message to yourself', 400, 'INVALID_REQUEST');
    }

    // Check if users are connected
    const areConnected = await networkService.areConnected(senderId, receiverId);

    // If not connected, this is a message request
    const isRequest = !areConnected;

    // Check if there's a pending message request
    if (isRequest) {
      const existingRequest = await prisma.message.findFirst({
        where: {
          senderId,
          receiverId,
          isRequest: true,
          requestStatus: 'PENDING',
        },
      });

      if (existingRequest) {
        throw new AppError('You already have a pending message request', 400, 'REQUEST_PENDING');
      }
    }

    const message = await prisma.message.create({
      data: {
        senderId,
        receiverId,
        content: data.content,
        mediaUrl: data.mediaUrl,
        isRequest,
        requestStatus: isRequest ? 'PENDING' : null,
      },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
      },
    });

    // Create notification
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { fullName: true },
    });

    await prisma.notification.create({
      data: {
        userId: receiverId,
        type: 'MESSAGE_RECEIVED',
        title: isRequest ? 'New Message Request' : 'New Message',
        message: `${sender?.fullName} sent you a message`,
        link: `/messages/${senderId}`,
      },
    });

    return message;
  }

  async respondToMessageRequest(userId: string, messageId: string, accept: boolean) {
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
      data: { requestStatus: accept ? 'ACCEPTED' : 'DECLINED' },
    });

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
    await prisma.message.updateMany({
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

    return { message: 'Messages marked as read' };
  }
}

export const messageService = new MessageService();
