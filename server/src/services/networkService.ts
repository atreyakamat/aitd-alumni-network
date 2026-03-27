import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { ConnectionStatus } from '@prisma/client';

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
    if (requesterId === addresseeId) {
      throw new AppError('Cannot connect with yourself', 400, 'INVALID_REQUEST');
    }

    // Check if connection already exists
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
        throw new AppError('Already connected', 400, 'ALREADY_CONNECTED');
      }
      if (existingConnection.status === 'PENDING') {
        throw new AppError('Connection request already pending', 400, 'REQUEST_PENDING');
      }
      if (existingConnection.status === 'BLOCKED') {
        throw new AppError('Cannot connect with this user', 400, 'BLOCKED');
      }
    }

    const connection = await prisma.connection.create({
      data: {
        requesterId,
        addresseeId,
        status: 'PENDING',
      },
    });

    // Notify the addressee
    const requester = await prisma.user.findUnique({
      where: { id: requesterId },
      select: { fullName: true },
    });

    await prisma.notification.create({
      data: {
        userId: addresseeId,
        type: 'CONNECTION_REQUEST',
        title: 'New Connection Request',
        message: `${requester?.fullName} wants to connect with you`,
        link: `/network/requests`,
      },
    });

    return { message: 'Connection request sent', connectionId: connection.id };
  }

  async respondToRequest(userId: string, connectionId: string, accept: boolean) {
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
      // Notify the requester
      const addressee = await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });

      await prisma.notification.create({
        data: {
          userId: connection.requesterId,
          type: 'CONNECTION_ACCEPTED',
          title: 'Connection Accepted',
          message: `${addressee?.fullName} accepted your connection request`,
          link: `/profile/${userId}`,
        },
      });
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

    await prisma.connection.delete({ where: { id: connectionId } });

    return { message: 'Connection removed' };
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

    // Get suggestions based on batch year, department, or location
    const suggestions = await prisma.user.findMany({
      where: {
        id: { notIn: Array.from(excludeIds) },
        isActive: true,
        isVerified: true,
        OR: [
          { batchYear: user.batchYear },
          { department: user.department },
          { city: user.city },
        ],
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
      take: limit,
    });

    // Add reason for suggestion
    return suggestions.map(s => ({
      ...s,
      reason: s.batchYear === user.batchYear
        ? 'Same batch year'
        : s.department === user.department
        ? 'Same department'
        : s.city === user.city
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
