import type { IncomingMessage } from 'http';
import type { Request } from 'express';

/**
 * Payment-gateway webhooks are authenticated by an HMAC over the exact request
 * bytes, so their raw body must survive JSON parsing and input sanitisation.
 */
export const WEBHOOK_PATH_PREFIX = '/api/payments/webhook/';

export type RawBodyRequest = Request & { rawBody?: Buffer };

const requestPath = (req: IncomingMessage) => (req as Partial<Request>).originalUrl ?? req.url ?? '';

export const isWebhookRequest = (req: IncomingMessage): boolean => requestPath(req).startsWith(WEBHOOK_PATH_PREFIX);

/** `verify` hook for express.json: keeps the unparsed bytes of webhook requests only. */
export const captureRawBody = (req: IncomingMessage, _res: unknown, buf: Buffer) => {
  if (isWebhookRequest(req)) (req as RawBodyRequest).rawBody = buf;
};
