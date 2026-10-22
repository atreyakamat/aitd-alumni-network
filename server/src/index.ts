import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { createApp } from './app';
import { initSocket } from './utils/socket';
import { createShutdown } from './utils/shutdown';
import prisma from './config/database';
import redis from './config/redis';

const PORT = process.env.PORT || 5000;
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure a PostgreSQL connection string before starting the server.');
}

if (!/^postgres(ql)?:\/\//i.test(DATABASE_URL)) {
  throw new Error('DATABASE_URL must use PostgreSQL (postgresql://...) for this project.');
}

if (process.env.NODE_ENV === 'production') {
  const weak = (s?: string) => !s || s.startsWith('default-') || s.length < 32;
  if (weak(process.env.JWT_SECRET) || weak(process.env.JWT_REFRESH_SECRET)) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be set to strong (32+ char) values in production.');
  }
}

const app = createApp();
const server = createServer(app);

// Initialize Socket.io
const io = initSocket(server);

const shutdown = createShutdown({
  server,
  io,
  prisma,
  redis,
  // Docker's default stop grace period is 10s
  timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) || 8000,
  exit: (code) => process.exit(code),
  log: (message) => console.log(message),
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`📁 Uploads: http://localhost:${PORT}/uploads`);
});

export default app;
