import crypto from 'crypto';
import prisma from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import {
  generateAccessToken,
  generateRefreshToken,
  generateTwoFactorToken,
  hashToken,
  verifyRefreshToken,
  verifyTwoFactorToken,
} from '../utils/jwt';
import { generateToken } from '../utils/helpers';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendWelcomeEmail,
} from '../utils/email';
import { AppError } from '../middleware/errorHandler';
import { logAuditAction } from './auditService';
import { MembershipTier, Prisma, RoleType, User } from '@prisma/client';
import { disconnectUser } from '../utils/socket';

interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  batchYear: number;
  department: string;
  degree: string;
  roleType?: RoleType;
}

interface LoginInput {
  email: string;
  password: string;
}

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

const MINUTE = 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * MINUTE;
const EMAIL_VERIFY_TTL_MS = 24 * 60 * MINUTE;
const PASSWORD_RESET_TTL_MS = 60 * MINUTE;
const OAUTH_EXCHANGE_TTL_MS = 5 * MINUTE;

/**
 * A rotated refresh token presented again within this window is treated as a
 * lost race (e.g. two browser tabs refreshing with the same token at once),
 * not theft: the request is rejected but the family is left alone. Nothing is
 * issued for the stale token, so the window grants an attacker nothing.
 */
export const REFRESH_REUSE_GRACE_MS = 15 * 1000;

export const TOKEN_TYPES = {
  EMAIL_VERIFY: 'EMAIL_VERIFY',
  PASSWORD_RESET: 'PASSWORD_RESET',
  OAUTH_EXCHANGE: 'OAUTH_EXCHANGE',
} as const;
type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

const GENERIC_RESET_MESSAGE = 'If the email exists, a password reset link has been sent.';

const normaliseEmail = (email: string) => email.trim().toLowerCase();

// Compared against when the account does not exist, so unknown emails cost the
// same bcrypt work as known ones (no timing-based user enumeration).
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex')));

type SessionUser = User & { membershipTier?: MembershipTier | null };

export class AuthService {
  private toAuthUser(user: SessionUser) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      profilePhotoUrl: user.profilePhotoUrl,
      userRole: user.userRole,
      isVerified: user.isVerified,
      membershipTier: user.membershipTier ?? null,
      profileCompleteness: user.profileCompleteness,
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
    };
  }

  private accessTokenFor(user: Pick<User, 'id' | 'email' | 'userRole'> & { tokenVersion?: number | null }) {
    return generateAccessToken(user.id, user.email, user.userRole, user.tokenVersion ?? 0);
  }

  /**
   * Issue an access token plus a DB-tracked (hashed) refresh token that starts
   * a new token family (one family per login on a device).
   */
  private async issueSession(user: SessionUser) {
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Housekeeping: revoked/rotated rows are kept until expiry for reuse detection
    await prisma.refreshToken.deleteMany({
      where: { userId: user.id, expiresAt: { lt: new Date() } },
    });

    const accessToken = this.accessTokenFor(user);
    const refreshToken = await this.storeRefreshToken(user.id, crypto.randomUUID());

    return { accessToken, refreshToken, user: this.toAuthUser(user) };
  }

  private async storeRefreshToken(
    userId: string,
    familyId: string,
    db: Pick<Prisma.TransactionClient, 'refreshToken'> = prisma
  ) {
    const refreshToken = generateRefreshToken(userId);
    await db.refreshToken.create({
      data: {
        userId,
        familyId,
        token: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    return refreshToken;
  }

  /**
   * A refresh token that was already rotated has been presented again: either
   * it was stolen or the legitimate client is replaying it. We cannot tell
   * which party holds the live token, so the whole family is revoked.
   */
  private async handleRefreshTokenReuse(userId: string, familyId: string | null): Promise<never> {
    await prisma.refreshToken.updateMany({
      where: familyId ? { userId, familyId, revokedAt: null } : { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    console.warn(`[auth] Refresh token reuse detected for user ${userId} (family ${familyId ?? 'legacy'}); family revoked`);
    await logAuditAction({
      userId,
      action: 'SECURITY_ALERT',
      entityType: 'USER',
      entityId: userId,
      newValues: { reason: 'REFRESH_TOKEN_REUSED', familyId },
    });

    throw new AppError('Refresh token reuse detected. Please sign in again.', 401, 'REFRESH_TOKEN_REUSED');
  }

  /** Persist a single-use opaque token (only its hash is stored) and return the raw value. */
  private async createOneTimeToken(userId: string, type: TokenType, ttlMs: number) {
    const raw = generateToken();
    await prisma.verificationToken.create({
      data: {
        userId,
        token: hashToken(raw),
        type,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return raw;
  }

  /** Atomically consume a single-use token of the given type. Returns null when invalid/expired/used. */
  private async consumeOneTimeToken(raw: string, type: TokenType) {
    if (!raw || typeof raw !== 'string') return null;

    const record = await prisma.verificationToken.findFirst({
      where: {
        token: hashToken(raw),
        type,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      include: { user: { include: { membershipTier: true } } },
    });
    if (!record) return null;

    // Conditional update so two concurrent requests cannot both redeem the token
    const claimed = await prisma.verificationToken.updateMany({
      where: { id: record.id, isUsed: false },
      data: { isUsed: true },
    });
    if (claimed.count !== 1) return null;

    return record;
  }

  async register(input: RegisterInput) {
    const email = normaliseEmail(input.email);
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);

    const { user, verificationToken } = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName: input.fullName.trim(),
          batchYear: input.batchYear,
          department: input.department,
          degree: input.degree,
          roleType: input.roleType || 'ALUMNI',
          profileCompleteness: 20,
        },
      });
      const raw = generateToken();
      await tx.verificationToken.create({
        data: {
          userId: created.id,
          token: hashToken(raw),
          type: TOKEN_TYPES.EMAIL_VERIFY,
          expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
        },
      });
      return { user: created, verificationToken: raw };
    });

    try {
      await sendVerificationEmail(user.email, user.fullName, verificationToken);
    } catch (error) {
      console.error('Failed to send verification email:', error);
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      message: 'Registration successful. Please check your email to verify your account.',
    };
  }

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: normaliseEmail(input.email) },
      include: { membershipTier: true },
    });

    if (!user || !user.passwordHash) {
      await comparePassword(input.password, await getDummyHash());
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isValid = await comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    // 2FA: no session yet - hand back a short-lived challenge bound to this user
    if (user.twoFactorEnabled) {
      return {
        requires2FA: true as const,
        twoFactorToken: generateTwoFactorToken(user.id),
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          twoFactorEnabled: true,
        },
      };
    }

    return this.issueSession(user);
  }

  /** Resolve a 2FA challenge token (from login) to the user it was issued for. */
  resolveTwoFactorChallenge(twoFactorToken: string): string {
    try {
      return verifyTwoFactorToken(twoFactorToken).userId;
    } catch {
      throw new AppError('Your verification session has expired. Please sign in again.', 401, 'INVALID_2FA_SESSION');
    }
  }

  async verifyEmail(token: string) {
    const record = await this.consumeOneTimeToken(token, TOKEN_TYPES.EMAIL_VERIFY);
    if (!record) {
      throw new AppError('Invalid or expired verification token', 400, 'INVALID_TOKEN');
    }

    await prisma.user.update({
      where: { id: record.userId },
      data: {
        isVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    try {
      await sendWelcomeEmail(record.user.email, record.user.fullName);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }

    return { message: 'Email verified successfully' };
  }

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: normaliseEmail(email) },
    });

    // Identical response whether or not the account exists (no enumeration)
    if (!user || !user.isActive) {
      return { message: GENERIC_RESET_MESSAGE };
    }

    // Only the most recent reset link is valid
    await prisma.verificationToken.deleteMany({
      where: { userId: user.id, type: TOKEN_TYPES.PASSWORD_RESET },
    });
    const resetToken = await this.createOneTimeToken(user.id, TOKEN_TYPES.PASSWORD_RESET, PASSWORD_RESET_TTL_MS);

    // Not awaited: response time must not reveal whether an email was sent
    sendPasswordResetEmail(user.email, user.fullName, resetToken).catch((error: unknown) => {
      console.error('Failed to send password reset email:', error);
    });

    return { message: GENERIC_RESET_MESSAGE };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.consumeOneTimeToken(token, TOKEN_TYPES.PASSWORD_RESET);
    if (!record) {
      throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.userId },
        // tokenVersion bump revokes every outstanding access token
        data: { passwordHash, tokenVersion: { increment: 1 } },
      });
      // Force re-login everywhere and burn any other outstanding reset links
      await tx.refreshToken.deleteMany({ where: { userId: record.userId } });
      await tx.verificationToken.deleteMany({
        where: { userId: record.userId, type: TOKEN_TYPES.PASSWORD_RESET },
      });
    });
    disconnectUser(record.userId);

    return { message: 'Password reset successful' };
  }

  /**
   * Signed-in password change. Revokes every session (access tokens via
   * tokenVersion, all refresh-token families) and hands the caller a fresh
   * session so the current device stays signed in.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string, meta: RequestMeta = {}) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }
    if (!user.isActive) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }
    if (!user.passwordHash) {
      throw new AppError(
        'Your account signs in with Google or LinkedIn and has no password yet. Use password reset ("Forgot password") to set one.',
        400,
        'PASSWORD_NOT_SET'
      );
    }

    const isValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new AppError('Current password is incorrect', 401, 'INVALID_PASSWORD');
    }
    if (newPassword === currentPassword) {
      throw new AppError('New password must be different from your current password', 400, 'PASSWORD_UNCHANGED');
    }

    const passwordHash = await hashPassword(newPassword);

    const { tokenVersion, refreshToken } = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { passwordHash, tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.verificationToken.deleteMany({ where: { userId, type: TOKEN_TYPES.PASSWORD_RESET } });
      // New family for this device, created after the wipe
      const fresh = await this.storeRefreshToken(userId, crypto.randomUUID(), tx);
      return { tokenVersion: updated.tokenVersion, refreshToken: fresh };
    });
    // Sockets opened with the old tokens close; the client reconnects with the new ones
    disconnectUser(userId);

    await logAuditAction({
      userId,
      action: 'PASSWORD_CHANGE',
      entityType: 'USER',
      entityId: userId,
      newValues: { sessionsRevoked: true },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    sendPasswordChangedEmail(user.email, user.fullName).catch((error: unknown) => {
      console.error('Failed to send password changed email:', error);
    });

    return {
      accessToken: this.accessTokenFor({ ...user, tokenVersion }),
      refreshToken,
      message: 'Password changed. Other devices have been signed out.',
    };
  }

  async refreshToken(refreshTokenValue: string) {
    let decoded: { userId: string };
    try {
      decoded = verifyRefreshToken(refreshTokenValue);
    } catch {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: hashToken(refreshTokenValue) },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.userId !== decoded.userId) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    if (tokenRecord.revokedAt) {
      if (Date.now() - tokenRecord.revokedAt.getTime() < REFRESH_REUSE_GRACE_MS) {
        // Lost a rotation race with another tab: the client should pick up the
        // token the winner stored rather than be logged out everywhere.
        throw new AppError('Refresh token was already rotated', 401, 'INVALID_REFRESH_TOKEN');
      }
      await this.handleRefreshTokenReuse(tokenRecord.userId, tokenRecord.familyId);
    }

    if (tokenRecord.expiresAt <= new Date()) {
      await prisma.refreshToken.deleteMany({ where: { id: tokenRecord.id } });
      throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const user = tokenRecord.user;
    if (!user.isActive) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    // Legacy rows (issued before families existed) become the root of a new family
    const familyId = tokenRecord.familyId ?? crypto.randomUUID();

    // Rotate: mark the old token revoked with a conditional update, so of two
    // concurrent requests only one can claim it. The revoked row is kept so a
    // later replay is recognised as reuse.
    const claimed = await prisma.refreshToken.updateMany({
      where: { id: tokenRecord.id, revokedAt: null },
      data: { revokedAt: new Date(), familyId },
    });
    if (claimed.count !== 1) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    const accessToken = this.accessTokenFor(user);
    const newRefreshToken = await this.storeRefreshToken(user.id, familyId);

    return {
      accessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(userId: string, refreshTokenValue?: string) {
    if (refreshTokenValue) {
      const token = hashToken(refreshTokenValue);
      const record = await prisma.refreshToken.findUnique({ where: { token } });

      // Scoped to the caller: a user can only revoke their own sessions.
      // Revoking the family also kills any token rotated from this one.
      await prisma.refreshToken.deleteMany({
        where: record?.familyId && record.userId === userId ? { userId, familyId: record.familyId } : { token, userId },
      });
    } else {
      // Logout from all devices: revoke refresh tokens and every issued access token
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });
        await tx.refreshToken.deleteMany({ where: { userId } });
      });
      disconnectUser(userId);
    }

    return { message: 'Logged out successfully' };
  }

  async getProfile(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membershipTier: true,
        workExperiences: {
          orderBy: { startDate: 'desc' },
        },
        educations: {
          orderBy: { startYear: 'desc' },
        },
        skills: {
          include: { skill: true },
        },
        chapterMemberships: {
          include: { chapter: true },
        },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }

  async completeLoginAfter2FA(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        membershipTier: true,
      },
    });

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    if (!user.isActive) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    return this.issueSession(user);
  }

  // Generate a one-time code for OAuth exchange (so JWTs never travel in URLs)
  async createOAuthExchangeCode(userId: string) {
    return this.createOneTimeToken(userId, TOKEN_TYPES.OAUTH_EXCHANGE, OAUTH_EXCHANGE_TTL_MS);
  }

  // Exchange the one-time code for real JWT tokens
  async exchangeOAuthCode(code: string) {
    const record = await this.consumeOneTimeToken(code, TOKEN_TYPES.OAUTH_EXCHANGE);
    if (!record) {
      throw new AppError('Invalid or expired exchange code', 400, 'INVALID_CODE');
    }

    if (!record.user.isActive) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    return this.issueSession(record.user);
  }
}

export const authService = new AuthService();
