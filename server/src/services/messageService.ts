import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { networkService } from './networkService';
import { notificationService } from './notificationService';
import { emitToUser } from '../utils/socket';
import { clientLinks } from '../utils/clientLinks';
import { optionalSafeMediaRef } from '../utils/safeUrl';

export const MESSAGE_MAX_LENGTH = 5000;
/** New message requests (messages to non-connections) one user may open per rolling 24 hours. */
export const MAX_MESSAGE_REQUESTS_PER_DAY = 20;

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

    // The database picks the latest message of every conversation and hands back just the requested page of them. The
    // member's whole history used to be loaded and grouped here, which got slower with every message ever sent.
    const latest = await prisma.$queryRaw<Array<{ id: string; partnerId: string; total: bigint | number }>>`
      WITH mine AS (
        SELECT id, "createdAt",
               CASE WHEN "senderId" = ${userId} THEN "receiverId" ELSE "senderId" END AS "partnerId"
        FROM "Message"
        WHERE "senderId" = ${userId} OR "receiverId" = ${userId}
      ),
      latest AS (
        SELECT DISTINCT ON ("partnerId") id, "partnerId", "createdAt"
        FROM mine
        ORDER BY "partnerId", "createdAt" DESC, id DESC
      )
      SELECT id, "partnerId", COUNT(*) OVER () AS total
      FROM latest
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${take} OFFSET ${skip}`;

    let total = latest.length > 0 ? Number(latest[0].total) : 0;
    if (latest.length === 0 && skip > 0) {
      // A page past the end still reports how many conversations there really are
      const [counted] = await prisma.$queryRaw<Array<{ total: bigint | number }>>`
        SELECT COUNT(DISTINCT CASE WHEN "senderId" = ${userId} THEN "receiverId" ELSE "senderId" END) AS total
        FROM "Message"
        WHERE "senderId" = ${userId} OR "receiverId" = ${userId}`;
      total = Number(counted?.total ?? 0);
    }

    const lastMessages =
      latest.length > 0
        ? await prisma.message.findMany({
            where: { id: { in: latest.map((row) => row.id) } },
            include: {
              sender: { select: participantSelect },
              receiver: { select: participantSelect },
            },
          })
        : [];
    const byId = new Map(lastMessages.map((message) => [message.id, message]));
    const page_ = latest
      .map((row) => [row.partnerId, byId.get(row.id)] as const)
      .filter((entry): entry is readonly [string, NonNullable<ReturnType<typeof byId.get>>] => entry[1] !== undefined);

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

    return buildPaginationResponse(conversations, total, safePage, safeLimit);
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
    const mediaUrl = optionalSafeMediaRef(data.mediaUrl, 'mediaUrl');

    const receiver = await prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, isActive: true },
    });
    if (!receiver || !receiver.isActive) {
      throw new AppError('Recipient not found', 404, 'NOT_FOUND');
    }

    // A block (set by either side) ends messaging, whatever was accepted before it
    const block = await prisma.connection.findFirst({
      where: {
        status: 'BLOCKED',
        OR: [
          { requesterId: senderId, addresseeId: receiverId },
          { requesterId: receiverId, addresseeId: senderId },
        ],
      },
      select: { id: true },
    });
    if (block) {
      throw new AppError('You cannot message this user', 403, 'BLOCKED');
    }

    const isRequest = !(await this.canMessageDirectly(senderId, receiverId));

    const message = await prisma.$transaction(async (tx) => {
      if (isRequest) {
        // The daily cap and the one-outstanding-request rule are "count, then insert": serialise one sender's requests,
        // otherwise a parallel burst reads the same low count and every request of it passes (30 of 30 got through).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`message-request:${senderId}`}))`;

        // Cap fan-out: one account must not be able to open requests to everybody
        const recentRequests =
          (await tx.message.count({
            where: { senderId, isRequest: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
          })) ?? 0;
        if (recentRequests >= MAX_MESSAGE_REQUESTS_PER_DAY) {
          throw new AppError('You have sent too many message requests today. Try again later.', 429, 'MESSAGE_REQUEST_LIMIT');
        }

        // Non-connections get exactly one outstanding request until the receiver accepts it
        const existingRequest = await tx.message.findFirst({
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

      return tx.message.create({
        data: {
          senderId,
          receiverId,
          content,
          mediaUrl,
          isRequest,
          requestStatus: isRequest ? 'PENDING' : null,
        },
        include: {
          sender: { select: participantSelect },
        },
      });
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
