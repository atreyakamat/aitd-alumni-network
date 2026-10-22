import crypto from 'crypto';
import jwt, { Secret } from 'jsonwebtoken';
import { config } from '../config';
import { JwtPayload } from '../middleware/auth';
import { UserRole } from '@prisma/client';

// Pin the algorithm so a token can never pick its own verification scheme.
const ALGORITHM = 'HS256' as const;
const TWO_FACTOR_PURPOSE = '2fa-challenge';
const TWO_FACTOR_TOKEN_TTL = '10m';

// 2FA challenge tokens are signed with a key derived from (but distinct from)
// the access-token secret, so a challenge can never be replayed as an access token.
const twoFactorSecret = (): Secret =>
  crypto.createHmac('sha256', config.jwt.secret).update(TWO_FACTOR_PURPOSE).digest('hex');

/**
 * `tv` carries the user's tokenVersion at issue time; bumping User.tokenVersion
 * revokes every access token issued before the bump (see middleware/auth).
 */
export const generateAccessToken = (
  userId: string,
  email: string,
  userRole: UserRole,
  tokenVersion = 0
): string => {
  const payload: JwtPayload = { userId, email, userRole, tv: tokenVersion };
  return jwt.sign(payload, config.jwt.secret as Secret, {
    expiresIn: config.jwt.expiresIn,
    algorithm: ALGORITHM,
  } as any);
};

export const generateRefreshToken = (userId: string): string => {
  // jti makes every refresh token unique even when two are issued in the same second
  return jwt.sign({ userId }, config.jwt.refreshSecret as Secret, {
    expiresIn: config.jwt.refreshExpiresIn,
    algorithm: ALGORITHM,
    jwtid: crypto.randomUUID(),
  } as any);
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwt.secret as Secret, { algorithms: [ALGORITHM] }) as JwtPayload;
};

export const verifyRefreshToken = (token: string): { userId: string } => {
  return jwt.verify(token, config.jwt.refreshSecret as Secret, { algorithms: [ALGORITHM] }) as {
    userId: string;
  };
};

/** Short-lived token proving the password step of a 2FA login succeeded. */
export const generateTwoFactorToken = (userId: string): string => {
  return jwt.sign({ userId, purpose: TWO_FACTOR_PURPOSE }, twoFactorSecret(), {
    expiresIn: TWO_FACTOR_TOKEN_TTL,
    algorithm: ALGORITHM,
  } as any);
};

export const verifyTwoFactorToken = (token: string): { userId: string } => {
  const decoded = jwt.verify(token, twoFactorSecret(), { algorithms: [ALGORITHM] }) as {
    userId?: string;
    purpose?: string;
  };
  if (decoded.purpose !== TWO_FACTOR_PURPOSE || !decoded.userId) {
    throw new jwt.JsonWebTokenError('invalid 2FA challenge token');
  }
  return { userId: decoded.userId };
};

/** One-way hash for opaque tokens persisted in the database (refresh, reset, verification, OAuth codes). */
export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};
