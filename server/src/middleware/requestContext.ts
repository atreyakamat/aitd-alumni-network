import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { log } from '../utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a response, its log lines and a user's bug report. Also sent back as X-Request-Id. */
      id?: string;
    }
  }
}

/** A caller-supplied id is only kept when it is short and plain: it ends up in logs and in a response header. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;
const MAX_ROUTE_LENGTH = 120;
const slowThresholdMs = () => Number(process.env.SLOW_REQUEST_MS) || 1000;

/**
 * Request id and access log.
 *
 * One line per finished request: id, method, route, status, duration (and the member id when signed in). The ROUTE
 * PATTERN is logged (`/api/invites/accept/:token`), never the concrete URL and never the query string, because tokens and
 * one-time codes travel in both. Health probes and successful static files are not logged: they would drown everything else.
 */
export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const supplied = req.get('x-request-id');
  const id = supplied && SAFE_ID.test(supplied) ? supplied : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const status = res.statusCode;
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (path === '/health') return;
    if (path.startsWith('/uploads/') && status < 400) return;

    const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const pattern = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : path.slice(0, MAX_ROUTE_LENGTH);
    const slow = ms >= slowThresholdMs();
    const fields: Record<string, unknown> = { id, method: req.method, route: pattern, status, ms };
    if (slow) fields.slow = true;
    if (req.user?.id) fields.user = req.user.id;

    if (status >= 500) log.error('request', fields);
    else if (slow) log.warn('request', fields);
    else log.info('request', fields);
  });

  next();
};
