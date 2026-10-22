import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';
import prisma from '../config/database';
import { isRevoked } from '../middleware/auth';
import config from '../config';

let io: SocketServer | undefined;

const MAX_ROOM_ID_LENGTH = 128;

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

export const registerConnectionHandlers = (socket: Socket) => {
  const userId: string = (socket as any).userId;
  console.log(`Socket connected: ${socket.id} (User: ${userId})`);

  // Join user-specific room for private notifications/messages
  socket.join(`user:${userId}`);

  socket.on('join_chat', (chatId: unknown) => {
    if (canJoinChat(userId, chatId)) {
      socket.join(`chat:${chatId}`);
    }
  });

  socket.on('leave_chat', (chatId: unknown) => {
    if (typeof chatId === 'string' && chatId) {
      socket.leave(`chat:${chatId}`);
    }
  });

  // Typing indicators are relayed to the recipient's private room only
  socket.on('typing', (payload: { receiverId?: unknown } | undefined) => {
    const receiverId = payload?.receiverId;
    if (typeof receiverId === 'string' && receiverId && receiverId !== userId) {
      emitToUser(receiverId, 'user_typing', { userId });
    }
  });

  socket.on('stop_typing', (payload: { receiverId?: unknown } | undefined) => {
    const receiverId = payload?.receiverId;
    if (typeof receiverId === 'string' && receiverId && receiverId !== userId) {
      emitToUser(receiverId, 'user_stop_typing', { userId });
    }
  });

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
