import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/database';
import { AppError } from './errorHandler';
import { UserRole } from '@prisma/client';
import { hasMinRole } from '../config/permissions';
import { verifyAccessToken } from '../utils/jwt';

export interface JwtPayload {
  userId: string;
  email: string;
  userRole: UserRole;
  /** User.tokenVersion when the token was issued. Missing (legacy tokens) means 0. */
  tv?: number;
}

const AUTH_USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  userRole: true,
  isActive: true,
  tokenVersion: true,
} as const;

/** True when the token was issued before the user's tokenVersion was bumped. */
export const isRevoked = (decoded: Pick<JwtPayload, 'tv'>, tokenVersion: number | null | undefined) =>
  (decoded.tv ?? 0) !== (tokenVersion ?? 0);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Combined User type for both JWT auth middleware and Passport OAuth
    interface User {
      id: string;
      email: string;
      fullName: string;
      userRole?: UserRole;
      profilePhotoUrl?: string;
      isNewUser?: boolean;
    }
    interface Request {
      user?: User;
    }
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('No token provided', 401, 'NO_TOKEN');
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const decoded = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: AUTH_USER_SELECT,
    });

    if (!user) {
      throw new AppError('User not found', 401, 'USER_NOT_FOUND');
    }

    if (!user.isActive) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    // Password reset / logout-everywhere / deactivation bump tokenVersion
    const { tokenVersion, ...authUser } = user;
    if (isRevoked(decoded, tokenVersion)) {
      throw new AppError('Session has been revoked', 401, 'TOKEN_REVOKED');
    }

    req.user = authUser;
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
    } else if (error instanceof jwt.TokenExpiredError) {
      // Must be checked before JsonWebTokenError, which it extends
      next(new AppError('Token expired', 401, 'TOKEN_EXPIRED'));
    } else if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.NotBeforeError) {
      next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
    } else {
      next(error);
    }
  }
};

export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const decoded = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: AUTH_USER_SELECT,
    });

    if (user && user.isActive) {
      const { tokenVersion, ...authUser } = user;
      if (!isRevoked(decoded, tokenVersion)) {
        req.user = authUser;
      }
    }
    next();
  } catch {
    // Invalid token, continue without auth
    next();
  }
};

export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
    }

    if (!req.user.userRole || !roles.includes(req.user.userRole)) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }

    next();
  };
};

/** Allow any role at or above `minimum` in the role hierarchy. */
export const requireRole = (minimum: UserRole) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
    }

    if (!hasMinRole(req.user.userRole, minimum)) {
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    }

    next();
  };
};

export const isChapterAdmin = requireRole('CHAPTER_ADMIN');
export const isAdmin = requireRole('ADMIN');
export const isSuperAdmin = requireRole('SUPER_ADMIN');
