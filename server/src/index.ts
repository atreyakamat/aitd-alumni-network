import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { createApp } from './app';
import { initSocket } from './utils/socket';
import { createShutdown } from './utils/shutdown';
import prisma from './config/database';
import redis from './config/redis';
import { assertProductionConfig } from './config/productionChecks';
import { startNotificationWorker } from './workers/notificationWorker';
import { startDigestWorker } from './workers/digestWorker';

const PORT = process.env.PORT || 5000;
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure a PostgreSQL connection string before starting the server.');
}

if (!/^postgres(ql)?:\/\//i.test(DATABASE_URL)) {
  throw new Error('DATABASE_URL must use PostgreSQL (postgresql://...) for this project.');
}

// Production refuses to start on an unsafe configuration (weak or leaked secrets, plain-http origins, no mail server
// while e-mail verification is required, ...). The same rules run in `npm run preflight`. See docs/PRODUCTION_CHECKLIST.md.
if (process.env.NODE_ENV === 'production') {
  assertProductionConfig(process.env);
}

const app = createApp();
const server = createServer(app);

// Initialize Socket.io
const io = initSocket(server);

// Background workers (no-op without Redis): broadcast notifications + weekly digest tick
const notificationWorker = startNotificationWorker();
const digestWorker = startDigestWorker();

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
const stop = async (signal: string) => {
  await Promise.all([
    notificationWorker?.close().catch(() => undefined),
    digestWorker?.close().catch(() => undefined),
  ]);
  await shutdown(signal);
};
process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 Health check: http://localhost:${PORT}/health`);
  console.log(`📁 Uploads: http://localhost:${PORT}/uploads`);
});

export default app;
