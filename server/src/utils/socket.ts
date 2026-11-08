import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';
import prisma from '../config/database';
import { isRevoked } from '../middleware/auth';
import config from '../config';

let io: SocketServer | undefined;

const MAX_ROOM_ID_LENGTH = 128;
/** Chat rooms one socket may hold at a time (room ids are client-chosen strings). */
export const MAX_JOINED_CHATS = 50;
/** Per-socket budget for client-originated events (typing indicators). */
export const SOCKET_EVENT_LIMIT = { max: 20, windowMs: 10_000 } as const;
/** How long a "may I relay to this user" decision is reused by a socket. */
const RELAY_DECISION_TTL_MS = 30_000;
const MAX_RELAY_DECISIONS = 200;

/** Pull the bearer token from the socket.io auth payload or the Authorization header. */
export const extractSocketToken = (socket: Pick<Socket, 'handshake'>): string | undefined => {
  const authToken = socket.handshake?.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) return authToken.trim();

  const header = socket.handshake?.headers?.authorization;
  if (typeof header === 'string') {
    const [scheme, value] = header.trim().split(/\s+/);
    if (scheme?.toLowerCase() === 'bearer' && value) return value;
  }
  return undefined;
};

/**
 * Handshake middleware: only sockets with a valid access token of an active
 * user may connect. Mirrors HTTP `authenticate`, including tokenVersion
 * revocation (password change/reset, logout-everywhere, deactivation).
 */
export const socketAuthMiddleware = async (socket: Socket, next: (err?: Error) => void) => {
  const token = extractSocketToken(socket);
  if (!token) {
    return next(new Error('Authentication error'));
  }

  try {
    const decoded = verifyAccessToken(token);
    if (!decoded?.userId) {
      return next(new Error('Authentication error'));
    }
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, isActive: true, tokenVersion: true },
    });
    if (!user || !user.isActive || isRevoked(decoded, user.tokenVersion)) {
      return next(new Error('Authentication error'));
    }
    (socket as any).userId = user.id;
    next();
  } catch {
    // Bad/expired token or lookup failure: fail closed
    next(new Error('Authentication error'));
  }
};

/**
 * A user may only join chat rooms whose id names them as a participant
 * (e.g. `<userA>:<userB>` or `<userA>_<userB>`), so nobody can subscribe to
 * someone else's conversation.
 */
export const canJoinChat = (userId: string, chatId: unknown): chatId is string => {
  if (typeof chatId !== 'string' || !chatId || chatId.length > MAX_ROOM_ID_LENGTH) return false;
  return chatId.split(/[:_]/).includes(userId);
};

/**
 * Typing indicators are only worth relaying between people who can actually talk: no block in
 * either direction, and either connected or already in an accepted conversation. Otherwise any
 * member could ping any other member's socket (harassment / presence probing).
 */
export const canRelayTo = async (userId: string, otherId: string): Promise<boolean> => {
  const pair = [
    { requesterId: userId, addresseeId: otherId },
    { requesterId: otherId, addresseeId: userId },
  ];
  const rows = await prisma.connection.findMany({
    where: { OR: pair, status: { in: ['ACCEPTED', 'BLOCKED'] } },
    select: { status: true },
  });
  if (rows?.some((row) => row.status === 'BLOCKED')) return false;
  if (rows?.some((row) => row.status === 'ACCEPTED')) return true;

  const thread = await prisma.message.findFirst({
    where: {
      OR: [
        { senderId: userId, receiverId: otherId },
        { senderId: otherId, receiverId: userId },
      ],
      AND: [{ OR: [{ isRequest: false }, { requestStatus: 'ACCEPTED' }] }],
    },
    select: { id: true },
  });
  return !!thread;
};

export const registerConnectionHandlers = (socket: Socket) => {
  const userId: string = (socket as any).userId;
  console.log(`Socket connected: ${socket.id} (User: ${userId})`);

  // Join user-specific room for private notifications/messages
  socket.join(`user:${userId}`);

  const joinedChats = new Set<string>();

  socket.on('join_chat', (chatId: unknown) => {
    if (!canJoinChat(userId, chatId)) return;
    if (!joinedChats.has(chatId) && joinedChats.size >= MAX_JOINED_CHATS) return;
    joinedChats.add(chatId);
    socket.join(`chat:${chatId}`);
  });

  socket.on('leave_chat', (chatId: unknown) => {
    if (typeof chatId === 'string' && chatId && chatId.length <= MAX_ROOM_ID_LENGTH) {
      joinedChats.delete(chatId);
      socket.leave(`chat:${chatId}`);
    }
  });

  // Sliding-window budget shared by every client-originated relay event on this socket
  const eventTimes: number[] = [];
  const withinBudget = () => {
    const now = Date.now();
    while (eventTimes.length && now - eventTimes[0] > SOCKET_EVENT_LIMIT.windowMs) eventTimes.shift();
    if (eventTimes.length >= SOCKET_EVENT_LIMIT.max) return false;
    eventTimes.push(now);
    return true;
  };

  const relayDecisions = new Map<string, { ok: boolean; until: number }>();
  const mayRelayTo = async (receiverId: string) => {
    const cached = relayDecisions.get(receiverId);
    if (cached && cached.until > Date.now()) return cached.ok;
    const ok = await canRelayTo(userId, receiverId);
    if (relayDecisions.size >= MAX_RELAY_DECISIONS) relayDecisions.clear();
    relayDecisions.set(receiverId, { ok, until: Date.now() + RELAY_DECISION_TTL_MS });
    return ok;
  };

  // Typing indicators are relayed to the recipient's private room only
  const relayPresence = (event: string, outbound: string) =>
    socket.on(event, async (payload: { receiverId?: unknown } | undefined) => {
      const receiverId = payload?.receiverId;
      if (typeof receiverId !== 'string' || !receiverId || receiverId === userId || receiverId.length > MAX_ROOM_ID_LENGTH) {
        return;
      }
      if (!withinBudget()) return;
      try {
        if (await mayRelayTo(receiverId)) emitToUser(receiverId, outbound, { userId });
      } catch (error) {
        console.warn('Socket relay check failed:', error);
      }
    });
  relayPresence('typing', 'user_typing');
  relayPresence('stop_typing', 'user_stop_typing');

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
};

export const initSocket = (server: HttpServer) => {
  io = new SocketServer(server, {
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },
  });

  io.use(socketAuthMiddleware);
  io.on('connection', registerConnectionHandlers);

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

export const emitToUser = (userId: string, event: string, data: any) => {
  if (io && userId) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

export const emitToRoom = (room: string, event: string, data: any) => {
  if (io && room) {
    io.to(room).emit(event, data);
  }
};

/**
 * Close every live socket of a user. Call after revoking their tokens (password
 * change/reset, deactivation, sign-out everywhere): the handshake check alone
 * would leave already-open connections running until they drop.
 */
export const disconnectUser = (userId: string) => {
  if (io && userId) {
    io.in(`user:${userId}`).disconnectSockets(true);
  }
};
