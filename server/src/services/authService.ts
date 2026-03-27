import prisma from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { generateToken, calculateProfileCompleteness } from '../utils/helpers';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from '../utils/email';
import { AppError } from '../middleware/errorHandler';
import { RoleType, UserRole } from '@prisma/client';

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

export class AuthService {
  async register(input: RegisterInput) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
    });

    if (existingUser) {
      throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');
    }

    const passwordHash = await hashPassword(input.password);
    const verificationToken = generateToken();

    const user = await prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        fullName: input.fullName,
        batchYear: input.batchYear,
        department: input.department,
        degree: input.degree,
        roleType: input.roleType || 'ALUMNI',
        profileCompleteness: 20,
      },
    });

    // Store verification token in redis or database (for simplicity, using a simple approach)
    // In production, use Redis with TTL
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Send verification email
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
      where: { email: input.email.toLowerCase() },
      include: {
        membershipTier: true,
      },
    });

    if (!user || !user.passwordHash) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    const isValid = await comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = generateAccessToken(user.id, user.email, user.userRole);
    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        profilePhotoUrl: user.profilePhotoUrl,
        userRole: user.userRole,
        isVerified: user.isVerified,
        membershipTier: user.membershipTier,
        profileCompleteness: user.profileCompleteness,
      },
    };
  }

  async verifyEmail(token: string) {
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      throw new AppError('Invalid or expired verification token', 400, 'INVALID_TOKEN');
    }

    await prisma.user.update({
      where: { id: tokenRecord.userId },
      data: {
        isVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    // Delete the verification token
    await prisma.refreshToken.delete({
      where: { id: tokenRecord.id },
    });

    // Send welcome email
    try {
      await sendWelcomeEmail(tokenRecord.user.email, tokenRecord.user.fullName);
    } catch (error) {
      console.error('Failed to send welcome email:', error);
    }

    return { message: 'Email verified successfully' };
  }

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Don't reveal if email exists
      return { message: 'If the email exists, a password reset link has been sent.' };
    }

    const resetToken = generateToken();

    // Store reset token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    try {
      await sendPasswordResetEmail(user.email, user.fullName, resetToken);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
    }

    return { message: 'If the email exists, a password reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      throw new AppError('Invalid or expired reset token', 400, 'INVALID_TOKEN');
    }

    const passwordHash = await hashPassword(newPassword);

    await prisma.user.update({
      where: { id: tokenRecord.userId },
      data: { passwordHash },
    });

    // Delete the reset token and all refresh tokens (force re-login)
    await prisma.refreshToken.deleteMany({
      where: { userId: tokenRecord.userId },
    });

    return { message: 'Password reset successful' };
  }

  async refreshToken(refreshTokenValue: string) {
    try {
      const decoded = verifyRefreshToken(refreshTokenValue);
      
      const tokenRecord = await prisma.refreshToken.findUnique({
        where: { token: refreshTokenValue },
        include: { user: true },
      });

      if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
        throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
      }

      const user = tokenRecord.user;
      
      if (!user.isActive) {
        throw new AppError('Account is deactivated', 401, 'ACCOUNT_DEACTIVATED');
      }

      // Generate new tokens
      const accessToken = generateAccessToken(user.id, user.email, user.userRole);
      const newRefreshToken = generateRefreshToken(user.id);

      // Delete old refresh token and create new one
      await prisma.refreshToken.delete({
        where: { id: tokenRecord.id },
      });

      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      throw new AppError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }
  }

  async logout(userId: string, refreshTokenValue?: string) {
    if (refreshTokenValue) {
      await prisma.refreshToken.deleteMany({
        where: { token: refreshTokenValue },
      });
    } else {
      // Logout from all devices
      await prisma.refreshToken.deleteMany({
        where: { userId },
      });
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

    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}

export const authService = new AuthService();
