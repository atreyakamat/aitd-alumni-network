import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { ConnectionStatus, Prisma } from '@prisma/client';
import { clientLinks } from '../utils/clientLinks';
import { notifyOnce } from './socialNotifications';

const MAX_SUGGESTIONS = 50;
export const DEFAULT_PENDING_PAGE_SIZE = 20;
/** Relationships read to keep existing contacts out of the suggestions; bounds the work for a very well connected member. */
export const MAX_SUGGESTION_EXCLUSIONS = 5000;

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
            batchYear: true,
            department: true,
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
            batchYear: true,
            department: true,
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

  /**
   * Pending connection requests, one page of each list (newest first). Response: `{ data: { received, sent }, pagination:
   * { received, sent } }`. `type` limits the read to one list: the other comes back empty and without pagination.
   * A very popular account can have thousands of requests waiting, so nothing here is unbounded.
   */
  async getPendingRequests(
    userId: string,
    page: number = 1,
    limit: number = DEFAULT_PENDING_PAGE_SIZE,
    type?: string
  ) {
    if (type !== undefined && type !== 'received' && type !== 'sent') {
      throw new AppError('type must be "received" or "sent"', 400, 'VALIDATION_ERROR');
    }
    const { skip, take, page: safePage, limit: safeLimit } = paginationHelper(
      page,
      Number.isFinite(limit) ? limit : DEFAULT_PENDING_PAGE_SIZE
    );
    const wantReceived = type !== 'sent';
    const wantSent = type !== 'received';
    const person = { id: true, fullName: true, profilePhotoUrl: true, currentDesignation: true, batchYear: true, department: true } as const;
    // The id breaks ties between requests made in the same instant, so no row is skipped or repeated between pages
    const newestFirst = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    const receivedWhere = { addresseeId: userId, status: 'PENDING' as const };
    const sentWhere = { requesterId: userId, status: 'PENDING' as const };

    const [received, receivedTotal, sent, sentTotal] = await Promise.all([
      wantReceived
        ? prisma.connection.findMany({ where: receivedWhere, include: { requester: { select: person } }, orderBy: newestFirst, skip, take })
        : Promise.resolve([]),
      wantReceived ? prisma.connection.count({ where: receivedWhere }) : Promise.resolve(0),
      wantSent
        ? prisma.connection.findMany({ where: sentWhere, include: { addressee: { select: person } }, orderBy: newestFirst, skip, take })
        : Promise.resolve([]),
      wantSent ? prisma.connection.count({ where: sentWhere }) : Promise.resolve(0),
    ]);

    const receivedRows = received ?? [];
    const sentRows = sent ?? [];
    return {
      data: {
        received: receivedRows.map(r => ({
          connectionId: r.id,
          user: r.requester,
          createdAt: r.createdAt,
        })),
        sent: sentRows.map(s => ({
          connectionId: s.id,
          user: s.addressee,
          createdAt: s.createdAt,
        })),
      },
      pagination: {
        ...(wantReceived ? { received: buildPaginationResponse([], receivedTotal ?? 0, safePage, safeLimit).pagination } : {}),
        ...(wantSent ? { sent: buildPaginationResponse([], sentTotal ?? 0, safePage, safeLimit).pagination } : {}),
      },
    };
  }

  async sendConnectionRequest(requesterId: string, addresseeId: string) {
    if (!addresseeId || requesterId === addresseeId) {
      throw new AppError('Cannot connect with yourself', 400, 'INVALID_REQUEST');
    }

    const addressee = await prisma.user.findUnique({
      where: { id: addresseeId, approvalStatus: 'APPROVED' },
      select: { id: true, isActive: true },
    });

    if (!addressee || !addressee.isActive) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    // Look up / create the single row of this pair as one step per pair. The unique index is on the ORDERED pair, so
    // without serialising, A->B and B->A sent at the same moment both find nothing and both insert (two PENDING rows).
    const outcome = await prisma.$transaction(async (tx) => {
      const pair = [requesterId, addresseeId].sort().join(':');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`connection:${pair}`}))`;

      // Check if a connection already exists in either direction
      const existingConnection = await tx.connection.findFirst({
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
          await tx.connection.update({
            where: { id: existingConnection.id },
            data: { status: 'ACCEPTED' },
          });
          return { accepted: true as const, connectionId: existingConnection.id };
        }
        // REJECTED: re-open the single row for this pair in the new direction
        // (the pair is unique, so creating a second row would collide/duplicate).
        const reopened = await tx.connection.update({
          where: { id: existingConnection.id },
          data: { requesterId, addresseeId, status: 'PENDING' },
        });
        return { accepted: false as const, connectionId: reopened.id };
      }

      const connection = await tx.connection.create({
        data: {
          requesterId,
          addresseeId,
          status: 'PENDING',
        },
      });
      return { accepted: false as const, connectionId: connection.id };
    });

    if (outcome.accepted) {
      await this.notify(requesterId, addresseeId, 'CONNECTION_ACCEPTED', outcome.connectionId);
      return { message: 'Connection accepted', connectionId: outcome.connectionId, status: 'ACCEPTED' as ConnectionStatus };
    }

    await this.notify(requesterId, addresseeId, 'CONNECTION_REQUEST', outcome.connectionId);

    return { message: 'Connection request sent', connectionId: outcome.connectionId, status: 'PENDING' as ConnectionStatus };
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

    const status: ConnectionStatus = accept ? 'ACCEPTED' : 'REJECTED';

    // Conditional update: of several concurrent responses to the same request exactly one changes it
    // (and therefore sends the notification); the rest find it no longer pending.
    const changed = await prisma.connection.updateMany({
      where: { id: connectionId, status: 'PENDING' },
      data: { status },
    });
    if (changed.count === 0) {
      throw new AppError('Request is no longer pending', 400, 'REQUEST_NOT_PENDING');
    }

    if (accept) {
      await this.notify(userId, connection.requesterId, 'CONNECTION_ACCEPTED', connection.id);
    }

    return {
      message: accept ? 'Connection accepted' : 'Connection declined',
      status,
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

    // Request -> decline -> request again (or accept -> remove -> connect again) must not tell the other person every time:
    // an equal notification from the same member within a day suppresses the new one (see socialNotifications.ts)
    if (type === 'CONNECTION_REQUEST') {
      await notifyOnce(actorId, [
        {
          userId: recipientId,
          type,
          title: 'New Connection Request',
          message: `${name} wants to connect with you`,
          link: clientLinks.network(),
          metadata: { requesterId: actorId, connectionId },
          dedupeBy: ['requesterId'],
        },
      ]);
    } else {
      await notifyOnce(actorId, [
        {
          userId: recipientId,
          type,
          title: 'Connection Accepted',
          message: `${name} accepted your connection request`,
          link: clientLinks.profile(actorId),
          metadata: { addresseeId: actorId, connectionId },
          dedupeBy: ['addresseeId'],
        },
      ]);
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
      orderBy: { createdAt: 'desc' },
      take: MAX_SUGGESTION_EXCLUSIONS,
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
