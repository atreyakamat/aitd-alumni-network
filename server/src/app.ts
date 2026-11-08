import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import passport from 'passport';
import { rateLimit } from 'express-rate-limit';
import routes from './routes';
import prisma from './config/database';
import redis from './config/redis';
import { AppError, errorHandler } from './middleware/errorHandler';
import { parseTrustProxy } from './utils/trustProxy';
import { RedisRateLimitStore } from './utils/redisRateLimitStore';
import { notFoundHandler } from './middleware/notFoundHandler';
import { sanitizeInput } from './middleware/sanitizeInput';
import { captureRawBody, isWebhookRequest, WEBHOOK_PATH_PREFIX } from './middleware/rawBody';
import './config/passport'; // Initialize passport strategies

export interface AppOptions {
  /** Disable rate limiting (used by the test suite). */
  disableRateLimit?: boolean;
}

/**
 * True when a request path under /uploads points into the private receipts folder, however it is spelled: any case,
 * percent-encoding, "." / ".." segments (the static handler normalises them AFTER a first-segment check would have
 * passed: /uploads/x/../receipts/f.pdf), repeated slashes, backslashes (path separators on Windows), and trailing
 * dots, spaces or ":stream" suffixes (ignored by the Windows file system).
 */
export const isReceiptsPath = (requestPath: string): boolean => {
  let decoded = requestPath;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    /* undecodable: the static handler answers 400 itself */
  }
  const normalised = path.posix.normalize('/' + decoded.split("\\").join('/'));
  return normalised
    .split('/')
    .some((segment) => segment.split(':')[0].replace(/[. ]+$/, '').toLowerCase() === 'receipts');
};

/** "http://user@host:port" at the start of an absolute-form request target (the authority ends at the first / ? or #). */
const ABSOLUTE_FORM_PREFIX = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

export const createApp = (options: AppOptions = {}) => {
  const app = express();
  // An explicit option wins; otherwise DISABLE_RATE_LIMIT=true turns limits off (tests)
  const rateLimitEnabled = options.disableRateLimit !== undefined
    ? !options.disableRateLimit
    : process.env.DISABLE_RATE_LIMIT !== 'true';

  // Collapse repeated slashes in the path before ANYTHING matches it. `app.use('/api', router)` also matches
  // "/api//auth/login" (its mount pattern swallows one slash), while the per-endpoint limiters mounted on
  // '/api/auth/login' do not: the doubled slash reached the login handler with only the global budget applied.
  // An ABSOLUTE-form request target ("POST http://host/api//auth/login HTTP/1.1", legal in HTTP/1.1) reaches Express with
  // the scheme and authority still in `req.url`, so it does not start with "/" and the origin-form check alone skipped it.
  // The "scheme://authority" prefix is left exactly as it is (Express's router measures it once, at the start of routing,
  // and slices `req.url` by that length: removing it here makes every mounted path miss, which is a 404 for the request)
  // and only the path behind it is collapsed.
  app.use((req, _res, next) => {
    const prefix = ABSOLUTE_FORM_PREFIX.exec(req.url)?.[0] ?? '';
    const target = req.url.slice(prefix.length);
    if (target.startsWith('/')) {
      const queryAt = target.indexOf('?');
      const pathname = queryAt === -1 ? target : target.slice(0, queryAt);
      if (pathname.includes('//')) {
        req.url = prefix + pathname.replace(/\/{2,}/g, '/') + (queryAt === -1 ? '' : target.slice(queryAt));
        req.originalUrl = req.url;
      }
    }
    next();
  });

  // Number of reverse proxies in front of the API (TRUST_PROXY, default 1); see utils/trustProxy.ts
  app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

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
        callback(new AppError('Origin not allowed', 403, 'FORBIDDEN_ORIGIN'));
      }
    },
    credentials: true,
  }));

  // Initialize Passport
  app.use(passport.initialize());

  if (rateLimitEnabled) {
    // With REDIS_URL set, every limiter counts in Redis so the budget is shared by all API processes/containers
    // (in memory it would be multiplied by their number). Without Redis, or while it is down, each process counts
    // for itself. Every limiter has its own key prefix.
    const shared = (name: string) => (redis ? { store: new RedisRateLimitStore(redis, `rl:${name}:`) } : {});

    app.use('/api/', rateLimit({
      ...shared('global'),
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 300,
      message: { success: false, error: { message: 'Too many requests, please try again later.', code: 'RATE_LIMITED' } },
      // Signed gateway webhooks are exempt: Razorpay retries deliveries and must never be throttled.
      skip: isWebhookRequest,
    }));

    // Auth endpoints have stricter, per-endpoint rate limits
    const authLimiter = (name: string, max: number) => rateLimit({
      ...shared(`auth:${name}`),
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
      '/api/auth/resend-verification',
      '/api/auth/oauth/exchange',
    ];
    for (const path of strictAuthPaths) {
      app.use(path, authLimiter(path, 10));
    }
    app.use('/api/auth/refresh-token', authLimiter('/api/auth/refresh-token', 60));

    // Abuse-prone endpoints that otherwise only had the global budget. Several paths can share one budget.
    const budget = (name: string, max: number, message: string) =>
      rateLimit({
        ...shared(`budget:${name}`),
        windowMs: 15 * 60 * 1000,
        max,
        message: { success: false, error: { message, code: 'RATE_LIMITED' } },
      });
    // 2FA management is rare for a real user
    app.use('/api/auth/2fa', budget('2fa', 10, 'Too many two-factor requests, please try again later.'));
    // Guest checkout creates a gateway order and a PENDING row per call
    app.use('/api/donations/order', budget('donations-order', 20, 'Too many donation attempts, please try again later.'));
    // Search is open to anonymous visitors and runs several ILIKE scans per call
    app.use('/api/search', budget('search', 100, 'Too many searches, please slow down.'));
    // Outbound e-mail from the platform's sender address
    app.use(['/api/invites/send', '/api/invites/bulk'], budget('invites', 30, 'Too many invitations sent, please try again later.'));
    // Uploads are the heaviest requests the API serves (image decoding, up to 100 MB of video)
    app.use(
      [
        '/api/posts/video', '/api/posts/media', '/api/users/profile-photo', '/api/users/cover-photo',
        '/api/videos/upload', '/api/videos/upload-thumbnail', '/api/magazine/upload-file', '/api/magazine/upload-cover', '/api/marketplace/upload-image',
      ],
      budget('uploads', 30, 'Too many uploads, please try again later.')
    );

    // Gateway webhooks are exempt from the global budget (Razorpay retries and must never be starved), but they are
    // reachable by anybody until the signature has been checked: give them their own, much larger, budget.
    app.use(WEBHOOK_PATH_PREFIX, rateLimit({
      ...shared('webhook'),
      windowMs: 15 * 60 * 1000,
      max: 1500,
      // The gateway is a machine client: no budget headers on its responses
      legacyHeaders: false,
      standardHeaders: false,
      message: { success: false, error: { message: 'Too many webhook requests.', code: 'RATE_LIMITED' } },
    }));

    // Place search proxies a shared upstream (OSM Nominatim); keep per-client bursts small
    app.use('/api/geo', rateLimit({
      ...shared('geo'),
      windowMs: 60 * 1000,
      max: 30,
      message: { success: false, error: { message: 'Too many place searches, please slow down.', code: 'RATE_LIMITED' } },
    }));
  }

  // PostgreSQL cannot store NUL bytes, so one in a path parameter would reach a query and fail as a 500.
  // (Bodies and query strings are cleaned by sanitizeInput.)
  app.use((req, res, next) => {
    if (/%00/i.test(req.path)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid request path', code: 'INVALID_PATH' } });
    }
    next();
  });

  // Body parsing
  // `verify` keeps the raw bytes of webhook requests for HMAC verification (see middleware/rawBody).
  // Webhook events are small JSON documents and unauthenticated until their signature is verified: parse them with a
  // small limit before the general (10 MB) parser, which then skips the already-parsed request.
  app.use(WEBHOOK_PATH_PREFIX, express.json({ limit: '256kb', verify: captureRawBody }));
  // 1 MB is far above any JSON the app really sends (the largest is a 50-row bulk invite). Uploads are multipart with
  // their own limits; every string of a body is walked by sanitizeInput, so the cap also bounds that work.
  app.use(express.json({ limit: '1mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(sanitizeInput);

  // Static files
  // Receipts (donor name, amount) are only available through the authenticated receipt endpoint, never as static files
  app.use('/uploads', (req, res, next) => {
    if (isReceiptsPath(req.path)) {
      return res.status(404).json({ success: false, error: { message: 'Not found', code: 'NOT_FOUND' } });
    }
    next();
  });
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
