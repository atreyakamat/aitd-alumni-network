import crypto from 'crypto';
import prisma from '../config/database';
import { sendEmail } from '../utils/email';
import { config } from '../config';
import { AppError } from '../middleware/errorHandler';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
/** Wrong guesses allowed per user inside the lockout window (across resends). */
export const OTP_MAX_ATTEMPTS = 5;
const OTP_LOCKOUT_MINUTES = 15;
const OTP_RESEND_COOLDOWN_SECONDS = 30;

const OTP_TYPE = 'TWO_FACTOR';
const OTP_FAILURE_TYPE = 'TWO_FACTOR_FAILURE';

export class TwoFactorService {
  // Cryptographically secure, uniformly distributed numeric OTP
  private generateOTP(): string {
    return crypto.randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
  }

  // Keyed hash bound to the user, so a leaked DB row cannot be brute-forced offline
  private hashOTP(userId: string, otp: string): string {
    return crypto.createHmac('sha256', config.jwt.secret).update(`${userId}:${otp}`).digest('hex');
  }

  private safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
  }

  private async recentFailures(userId: string): Promise<number> {
    return prisma.verificationToken.count({
      where: { userId, type: OTP_FAILURE_TYPE, expiresAt: { gt: new Date() } },
    });
  }

  private async recordFailure(userId: string): Promise<void> {
    await prisma.verificationToken.create({
      data: {
        userId,
        type: OTP_FAILURE_TYPE,
        token: crypto.randomBytes(16).toString('hex'),
        expiresAt: new Date(Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000),
      },
    });
  }

  // Generate and send OTP to user's email
  async sendOTP(userId: string, email: string): Promise<{ message: string }> {
    const otp = this.generateOTP();
    const hashedOTP = this.hashOTP(userId, otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Only the latest code is valid
    await prisma.verificationToken.deleteMany({
      where: {
        userId,
        type: OTP_TYPE,
      },
    });

    await prisma.verificationToken.create({
      data: {
        userId,
        token: hashedOTP,
        type: OTP_TYPE,
        expiresAt,
      },
    });

    await sendEmail({
      to: email,
      subject: 'Your AITD Connection Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #002045 0%, #004488 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 24px;">AITD Connection</h1>
          </div>

          <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
            <h2 style="color: #002045; margin-top: 0;">Your Verification Code</h2>

            <p style="color: #64748b; line-height: 1.6;">
              Use the following code to complete your sign-in. This code expires in ${OTP_EXPIRY_MINUTES} minutes.
            </p>

            <div style="background: #f8fafc; border: 2px dashed #002045; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #002045;">
                ${otp}
              </span>
            </div>

            <p style="color: #64748b; line-height: 1.6;">
              If you didn't request this code, please ignore this email or contact support if you have concerns.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">

            <p style="color: #94a3b8; font-size: 12px; margin-bottom: 0;">
              This is an automated message from AITD Connection. Please do not reply to this email.
            </p>
          </div>
        </div>
      `,
    });

    return { message: 'Verification code sent to your email' };
  }

  /** Resend a code for a pending 2FA login, with a short cooldown to prevent mail-bombing. */
  async resendOTP(userId: string): Promise<{ message: string }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isActive: true, twoFactorEnabled: true },
    });

    if (!user || !user.isActive || !user.twoFactorEnabled) {
      throw new AppError('Your verification session has expired. Please sign in again.', 401, 'INVALID_2FA_SESSION');
    }

    const recent = await prisma.verificationToken.findFirst({
      where: {
        userId,
        type: OTP_TYPE,
        createdAt: { gt: new Date(Date.now() - OTP_RESEND_COOLDOWN_SECONDS * 1000) },
      },
    });
    if (recent) {
      throw new AppError('Please wait before requesting another code', 429, 'OTP_RESEND_TOO_SOON');
    }

    return this.sendOTP(userId, user.email);
  }

  /**
   * Verify the OTP. Returns false for a wrong/expired/used code; throws 429
   * once the user has exhausted their attempts for the lockout window.
   */
  async verifyOTP(userId: string, otp: string): Promise<boolean> {
    if ((await this.recentFailures(userId)) >= OTP_MAX_ATTEMPTS) {
      throw new AppError(
        'Too many invalid verification attempts. Please try again later.',
        429,
        'OTP_ATTEMPTS_EXCEEDED'
      );
    }

    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        userId,
        type: OTP_TYPE,
        expiresAt: { gt: new Date() },
        isUsed: false,
      },
      orderBy: { createdAt: 'desc' },
    });

    const candidate = typeof otp === 'string' ? otp.trim() : '';
    const matches =
      !!verificationToken &&
      /^\d+$/.test(candidate) &&
      this.safeEqual(this.hashOTP(userId, candidate), verificationToken.token);

    if (!matches) {
      await this.recordFailure(userId);
      if ((await this.recentFailures(userId)) >= OTP_MAX_ATTEMPTS) {
        // Burn the outstanding code once the attempt budget is spent
        await prisma.verificationToken.deleteMany({ where: { userId, type: OTP_TYPE } });
      }
      return false;
    }

    // Conditional update: a code can only be redeemed once, even under concurrency
    const claimed = await prisma.verificationToken.updateMany({
      where: { id: verificationToken!.id, isUsed: false },
      data: { isUsed: true },
    });
    if (claimed.count !== 1) {
      return false;
    }

    await prisma.verificationToken.deleteMany({ where: { userId, type: OTP_FAILURE_TYPE } });
    return true;
  }

  // Enable 2FA for a user
  async enable2FA(userId: string): Promise<{ message: string }> {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true },
    });

    return { message: 'Two-factor authentication enabled' };
  }

  // Disable 2FA for a user
  async disable2FA(userId: string): Promise<{ message: string }> {
    await prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false },
    });

    return { message: 'Two-factor authentication disabled' };
  }

  // Check if 2FA is enabled for a user
  async is2FAEnabled(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true },
    });

    return user?.twoFactorEnabled || false;
  }
}

export const twoFactorService = new TwoFactorService();
