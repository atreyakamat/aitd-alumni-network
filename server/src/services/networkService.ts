import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { ConnectionStatus, Prisma } from '@prisma/client';
import { notificationService } from './notificationService';
import { clientLinks } from '../utils/clientLinks';

const MAX_SUGGESTIONS = 50;

export class NetworkService {
  async getConnections(userId: string, page: number = 1, limit: number = 20) {
    const { skip, take } = paginationHelper(page, limit);

    const connections = await prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: userId, status: 'ACCEPTED' },
          { addresseeId: userId, status: 'ACCEPTED' },
        ],
      },
      include: {
        requester: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
            city: true,
            membershipTier: {
              select: { name: true, badgeColor: true },
            },
          },
        },
        addressee: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
            city: true,
            membershipTier: {
              select: { name: true, badgeColor: true },
            },
          },
        },
      },
      skip,
      take,
      orderBy: { updatedAt: 'desc' },
    });

    const total = await prisma.connection.count({
      where: {
        OR: [
          { requesterId: userId, status: 'ACCEPTED' },
          { addresseeId: userId, status: 'ACCEPTED' },
        ],
      },
    });

    // Get the other user in each connection
    const connectedUsers = connections.map(conn => {
      const otherUser = conn.requesterId === userId ? conn.addressee : conn.requester;
      return {
        connectionId: conn.id,
        connectedAt: conn.updatedAt,
        ...otherUser,
      };
    });

    return buildPaginationResponse(connectedUsers, total, page, limit);
  }

  async getPendingRequests(userId: string) {
    const [received, sent] = await Promise.all([
      prisma.connection.findMany({
        where: { addresseeId: userId, status: 'PENDING' },
        include: {
          requester: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              currentDesignation: true,
              batchYear: true,
              department: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.connection.findMany({
        where: { requesterId: userId, status: 'PENDING' },
        include: {
          addressee: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              currentDesignation: true,
              batchYear: true,
              department: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      received: received.map(r => ({
        connectionId: r.id,
        user: r.requester,
        createdAt: r.createdAt,
      })),
      sent: sent.map(s => ({
        connectionId: s.id,
        user: s.addressee,
        createdAt: s.createdAt,
      })),
    };
  }

  async sendConnectionRequest(requesterId: string, addresseeId: string) {
    if (!addresseeId || requesterId === addresseeId) {
      throw new AppError('Cannot connect with yourself', 400, 'INVALID_REQUEST');
    }

    const addressee = await prisma.user.findUnique({
      where: { id: addresseeId },
      select: { id: true, isActive: true },
    });

    if (!addressee || !addressee.isActive) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    // Check if a connection already exists in either direction
    const existingConnection = await prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId, addresseeId },
          { requesterId: addresseeId, addresseeId: requesterId },
        ],
      },
    });

    if (existingConnection) {
      if (existingConnection.status === 'ACCEPTED') {
        throw new AppError('Already connected', 409, 'ALREADY_CONNECTED');
      }
      if (existingConnection.status === 'BLOCKED') {
        throw new AppError('Cannot connect with this user', 403, 'BLOCKED');
      }
      if (existingConnection.status === 'PENDING') {
        if (existingConnection.requesterId === requesterId) {
          throw new AppError('Connection request already pending', 409, 'REQUEST_PENDING');
        }
        // The other user already asked us: sending a request back accepts theirs.
        await prisma.connection.update({
          where: { id: existingConnection.id },
          data: { status: 'ACCEPTED' },
        });
        await this.notify(requesterId, addresseeId, 'CONNECTION_ACCEPTED', existingConnection.id);
        return { message: 'Connection accepted', connectionId: existingConnection.id, status: 'ACCEPTED' as ConnectionStatus };
      }
      // REJECTED: re-open the single row for this pair in the new direction
      // (the pair is unique, so creating a second row would collide/duplicate).
      const reopened = await prisma.connection.update({
        where: { id: existingConnection.id },
        data: { requesterId, addresseeId, status: 'PENDING' },
      });
      await this.notify(requesterId, addresseeId, 'CONNECTION_REQUEST', reopened.id);
      return { message: 'Connection request sent', connectionId: reopened.id, status: 'PENDING' as ConnectionStatus };
    }

    const connection = await prisma.connection.create({
      data: {
        requesterId,
        addresseeId,
        status: 'PENDING',
      },
    });

    await this.notify(requesterId, addresseeId, 'CONNECTION_REQUEST', connection.id);

    return { message: 'Connection request sent', connectionId: connection.id, status: 'PENDING' as ConnectionStatus };
  }

  async respondToRequest(userId: string, connectionId: string, accept: boolean) {
    if (typeof accept !== 'boolean') {
      throw new AppError('accept must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new AppError('Connection request not found', 404, 'NOT_FOUND');
    }

    if (connection.addresseeId !== userId) {
      throw new AppError('Not authorized to respond to this request', 403, 'FORBIDDEN');
    }

    if (connection.status !== 'PENDING') {
      throw new AppError('Request is no longer pending', 400, 'REQUEST_NOT_PENDING');
    }

    const updatedConnection = await prisma.connection.update({
      where: { id: connectionId },
      data: { status: accept ? 'ACCEPTED' : 'REJECTED' },
    });

    if (accept) {
      await this.notify(userId, connection.requesterId, 'CONNECTION_ACCEPTED', connection.id);
    }

    return {
      message: accept ? 'Connection accepted' : 'Connection declined',
      status: updatedConnection.status,
    };
  }

  async removeConnection(userId: string, connectionId: string) {
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      throw new AppError('Connection not found', 404, 'NOT_FOUND');
    }

    if (connection.requesterId !== userId && connection.addresseeId !== userId) {
      throw new AppError('Not authorized to remove this connection', 403, 'FORBIDDEN');
    }

    // Deleting a block row would let the blocked party lift the block themselves.
    if (connection.status === 'BLOCKED') {
      throw new AppError('Cannot remove a blocked connection', 403, 'BLOCKED');
    }

    await prisma.connection.delete({ where: { id: connectionId } });

    return { message: 'Connection removed' };
  }

  private async notify(
    actorId: string,
    recipientId: string,
    type: 'CONNECTION_REQUEST' | 'CONNECTION_ACCEPTED',
    connectionId: string
  ) {
    const actor = await prisma.user.findUnique({
      where: { id: actorId },
      select: { fullName: true },
    });
    const name = actor?.fullName ?? 'Someone';

    if (type === 'CONNECTION_REQUEST') {
      await notificationService.createNotification({
        userId: recipientId,
        type,
        title: 'New Connection Request',
        message: `${name} wants to connect with you`,
        link: clientLinks.network(),
        metadata: { requesterId: actorId, connectionId },
      });
    } else {
      await notificationService.createNotification({
        userId: recipientId,
        type,
        title: 'Connection Accepted',
        message: `${name} accepted your connection request`,
        link: clientLinks.profile(actorId),
        metadata: { addresseeId: actorId, connectionId },
      });
    }
  }

  async getSuggestions(userId: string, limit: number = 10) {
    // Get user's info for matching
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { batchYear: true, department: true, city: true },
    });

    if (!user) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    // Get existing connections and pending requests
    const existingConnections = await prisma.connection.findMany({
      where: {
        OR: [
          { requesterId: userId },
          { addresseeId: userId },
        ],
      },
      select: {
        requesterId: true,
        addresseeId: true,
      },
    });

    const excludeIds = new Set([userId]);
    existingConnections.forEach(c => {
      excludeIds.add(c.requesterId);
      excludeIds.add(c.addresseeId);
    });

    // Match on batch year, department or city, ignoring attributes the user hasn't set
    // (a null city would otherwise match everyone else without a city).
    const criteria: Prisma.UserWhereInput[] = [];
    if (user.batchYear !== null && user.batchYear !== undefined) criteria.push({ batchYear: user.batchYear });
    if (user.department) criteria.push({ department: user.department });
    if (user.city) criteria.push({ city: user.city });
    if (criteria.length === 0) return [];

    const take = Math.min(MAX_SUGGESTIONS, Math.max(1, Math.floor(Number(limit)) || 10));

    const suggestions = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludeIds) },
        isActive: true,
        isVerified: true,
        OR: criteria,
      },
      select: {
        id: true,
        fullName: true,
        profilePhotoUrl: true,
        currentDesignation: true,
        batchYear: true,
        department: true,
        city: true,
        membershipTier: {
          select: { name: true, badgeColor: true },
        },
      },
      take,
    });

    // Add reason for suggestion
    return suggestions.map(s => ({
      ...s,
      reason: s.batchYear === user.batchYear
        ? 'Same batch year'
        : s.department === user.department
        ? 'Same department'
        : user.city && s.city === user.city
        ? 'In your city'
        : 'Alumni',
    }));
  }

  // Check if two users are connected
  async areConnected(userId1: string, userId2: string): Promise<boolean> {
    const connection = await prisma.connection.findFirst({
      where: {
        OR: [
          { requesterId: userId1, addresseeId: userId2, status: 'ACCEPTED' },
          { requesterId: userId2, addresseeId: userId1, status: 'ACCEPTED' },
        ],
      },
    });

    return !!connection;
  }
}

export const networkService = new NetworkService();
