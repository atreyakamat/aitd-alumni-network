import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import passport from 'passport';
import { rateLimit } from 'express-rate-limit';
import routes from './routes';
import prisma from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { sanitizeInput } from './middleware/sanitizeInput';
import { captureRawBody, isWebhookRequest } from './middleware/rawBody';
import './config/passport'; // Initialize passport strategies

export interface AppOptions {
  /** Disable rate limiting (used by the test suite). */
  disableRateLimit?: boolean;
}

export const createApp = (options: AppOptions = {}) => {
  const app = express();
  // An explicit option wins; otherwise DISABLE_RATE_LIMIT=true turns limits off (tests)
  const rateLimitEnabled = options.disableRateLimit !== undefined
    ? !options.disableRateLimit
    : process.env.DISABLE_RATE_LIMIT !== 'true';

  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: false, // Allow loading images from local server
  }));
  app.use(cors({
    origin: (origin, callback) => {
      const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || ['http://localhost:3000'];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));

  // Initialize Passport
  app.use(passport.initialize());

  if (rateLimitEnabled) {
    app.use('/api/', rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 300,
      message: { success: false, error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' } },
      // Signed gateway webhooks are exempt: Razorpay retries deliveries and must never be throttled.
      skip: isWebhookRequest,
    }));

    // Auth endpoints have stricter, per-endpoint rate limits
    const authLimiter = (max: number) => rateLimit({
      windowMs: 15 * 60 * 1000,
      max,
      message: { success: false, error: { message: 'Too many authentication attempts, please try again later.', code: 'RATE_LIMITED' } },
    });
    const strictAuthPaths = [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/forgot-password',
      '/api/auth/reset-password',
      '/api/auth/change-password',
      '/api/auth/verify-2fa',
      '/api/auth/resend-2fa',
      '/api/auth/verify-email',
      '/api/auth/oauth/exchange',
    ];
    for (const path of strictAuthPaths) {
      app.use(path, authLimiter(10));
    }
    app.use('/api/auth/refresh-token', authLimiter(60));

    // Place search proxies a shared upstream (OSM Nominatim); keep per-client bursts small
    app.use('/api/geo', rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: { success: false, error: { message: 'Too many place searches, please slow down.', code: 'RATE_LIMITED' } },
    }));
  }

  // Body parsing
  // `verify` keeps the raw bytes of webhook requests for HMAC verification (see middleware/rawBody)
  app.use(express.json({ limit: '10mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(sanitizeInput);

  // Static files
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // Health check
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: 'ok',
        database: 'postgresql',
        databaseStatus: 'up',
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: 'degraded',
        database: 'postgresql',
        databaseStatus: 'down',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // API Routes
  app.use('/api', routes);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};

export default createApp;
