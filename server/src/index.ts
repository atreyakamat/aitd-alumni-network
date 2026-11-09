import dotenv from 'dotenv';
dotenv.config();

import { createServer } from 'http';
import { createApp } from './app';
import { initSocket } from './utils/socket';
import { createShutdown } from './utils/shutdown';
import prisma from './config/database';
import redis from './config/redis';
import { assertProductionConfig } from './config/productionChecks';
import { registerProcessHandlers } from './utils/processHandlers';
import { log } from './utils/logger';
import { startNotificationWorker } from './workers/notificationWorker';
import { startDigestWorker } from './workers/digestWorker';
import { startNotificationConsumer } from './workers/notificationConsumer';

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
// Notification events (in-app notifications, e-mail to the college administrator and to applicants): Kafka consumer.
// Starts in the background and never blocks the API; null without KAFKA_BROKERS (events are then handled in-process).
const notificationConsumer = startNotificationConsumer();

const shutdown = createShutdown({
  server,
  io,
  prisma,
  redis,
  // Docker's default stop grace period is 10s
  timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS) || 8000,
  exit: (code) => process.exit(code),
  log: (message, level = 'info') => log[level](message),
});
const stop = async (signal: string, failed = false) => {
  await Promise.all([
    notificationWorker?.close().catch(() => undefined),
    digestWorker?.close().catch(() => undefined),
    notificationConsumer?.stop().catch(() => undefined),
  ]);
  await shutdown(signal, failed);
};
// SIGTERM/SIGINT drain gracefully; a crash drains and exits non-zero; a stray rejection is logged (utils/processHandlers.ts)
registerProcessHandlers({ proc: process, shutdown: stop });

// Behind nginx or a load balancer the proxy closes idle connections first (nginx keepalive_timeout is 65s). If Node closed
// them sooner, the proxy would occasionally reuse a connection that is already gone and return a 502.
// headersTimeout must stay above keepAliveTimeout. Uploads of up to 100 MB can take minutes: requestTimeout is generous.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS) || 10 * 60 * 1000;

server.listen(PORT, () => {
  log.info('Server running', { port: Number(PORT), health: `http://localhost:${PORT}/health`, env: process.env.NODE_ENV || 'development' });
});

export default app;
