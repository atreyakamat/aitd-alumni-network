import jwt, { Secret } from 'jsonwebtoken';
import { config } from '../config';
import { JwtPayload } from '../middleware/auth';
import { UserRole } from '@prisma/client';

export const generateAccessToken = (
  userId: string,
  email: string,
  userRole: UserRole
): string => {
  const payload: JwtPayload = { userId, email, userRole };
  return jwt.sign(payload, config.jwt.secret as Secret, {
    expiresIn: config.jwt.expiresIn,
  } as any);
};

export const generateRefreshToken = (userId: string): string => {
  return jwt.sign({ userId }, config.jwt.refreshSecret as Secret, {
    expiresIn: config.jwt.refreshExpiresIn,
  } as any);
};

export const verifyAccessToken = (token: string): JwtPayload => {
  return jwt.verify(token, config.jwt.secret as Secret) as JwtPayload;
};

export const verifyRefreshToken = (token: string): { userId: string } => {
  return jwt.verify(token, config.jwt.refreshSecret as Secret) as { userId: string };
};

export const generateEmailVerificationToken = (): string => {
  return jwt.sign({}, config.jwt.secret as Secret, { expiresIn: '24h' } as any);
};

export const generatePasswordResetToken = (): string => {
  return jwt.sign({}, config.jwt.secret as Secret, { expiresIn: '1h' } as any);
};
