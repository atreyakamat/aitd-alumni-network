import { Server as SocketServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { verifyAccessToken } from './jwt';
import config from '../config';

let io: SocketServer;

export const initSocket = (server: HttpServer) => {
  io = new SocketServer(server, {
    cors: {
      origin: config.corsOrigins,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
    if (!token) {
      return next(new Error('Authentication error'));
    }

    try {
      const decoded = verifyAccessToken(token);
      (socket as any).userId = decoded.userId;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    const userId = (socket as any).userId;
    console.log(`Socket connected: ${socket.id} (User: ${userId})`);

    // Join user-specific room for private notifications/messages
    socket.join(`user:${userId}`);

    socket.on('join_chat', (chatId: string) => {
      socket.join(`chat:${chatId}`);
    });

    socket.on('leave_chat', (chatId: string) => {
      socket.leave(`chat:${chatId}`);
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};

export const emitToUser = (userId: string, event: string, data: any) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

export const emitToRoom = (room: string, event: string, data: any) => {
  if (io) {
    io.to(room).emit(event, data);
  }
};
