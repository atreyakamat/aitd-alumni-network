import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import config from '../config';

/**
 * OAuth `state` (login-CSRF) protection without server sessions.
 *
 * Before redirecting to the provider we mint a random value, hand it to the provider as the
 * `state` parameter and also pin it to the browser in a short-lived HttpOnly cookie. The callback
 * only proceeds when the `state` echoed by the provider equals that cookie. An attacker cannot
 * make a victim's browser complete the attacker's own authorization response, because the victim
 * never received the matching cookie.
 */

export const OAUTH_STATE_COOKIE = 'oauth_state';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
// The cookie is only needed by the provider callbacks under /api/auth
const COOKIE_PATH = '/api/auth';

const cookieOptions = () => ({
  httpOnly: true,
  // Lax: the provider's redirect back to the callback is a top-level GET navigation
  sameSite: 'lax' as const,
  secure: config.nodeEnv === 'production',
  path: COOKIE_PATH,
});

/** Parse a single cookie out of the raw header (no cookie-parser dependency). */
const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers?.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
};

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length > 0 && bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

/** Mint a state value, pin it to the browser and return it for the provider redirect. */
export const issueOAuthState = (res: Response): string => {
  const state = crypto.randomBytes(24).toString('hex');
  res.cookie(OAUTH_STATE_COOKIE, state, { ...cookieOptions(), maxAge: OAUTH_STATE_TTL_MS });
  return state;
};

/** Callback guard: the provider's `state` must match the cookie set when the flow started. */
export const verifyOAuthState = (req: Request, res: Response, next: NextFunction) => {
  const expected = readCookie(req, OAUTH_STATE_COOKIE);
  const received = typeof req.query?.state === 'string' ? req.query.state : undefined;

  // One use only, whatever the outcome
  res.clearCookie(OAUTH_STATE_COOKIE, cookieOptions());

  if (!expected || !received || !safeEqual(expected, received)) {
    return res.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
  }
  next();
};
