import jwt from 'jsonwebtoken';
import { config } from '../config';
import { JwtPayload } from '../middleware/auth';
import { UserRole } from '@prisma/client';

export const generateAccessToken = (
  userId: string,
  email: string,
  userRole: UserRole
): string => {
  const payload: JwtPayload = { userId, email, userRole };
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ userId }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
  });
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwt.secret) as JwtPayload;
};

export const verifyRefreshToken = (token: string): { userId: string } => {
  return jwt.verify(token, config.jwt.refreshSecret) as { userId: string };
};

export const generateEmailVerificationToken = (): string => {
  return jwt.sign({}, config.jwt.secret, { expiresIn: '24h' });
};

export const generatePasswordResetToken = (): string => {
  return jwt.sign({}, config.jwt.secret, { expiresIn: '1h' });
};
