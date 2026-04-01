import prisma from '../config/database';
import { sendEmail } from '../utils/email';
import crypto from 'crypto';

const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;

export class TwoFactorService {
  // Generate a random OTP
  private generateOTP(): string {
    const digits = '0123456789';
    let otp = '';
    for (let i = 0; i < OTP_LENGTH; i++) {
      otp += digits[Math.floor(Math.random() * 10)];
    }
    return otp;
  }

  // Hash the OTP for storage
  private hashOTP(otp: string): string {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  // Generate and send OTP to user's email
  async sendOTP(userId: string, email: string): Promise<{ message: string }> {
    const otp = this.generateOTP();
    const hashedOTP = this.hashOTP(otp);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Delete any existing OTPs for this user
    await prisma.verificationToken.deleteMany({
      where: {
        userId,
        type: 'TWO_FACTOR',
      },
    });

    // Store the hashed OTP
    await prisma.verificationToken.create({
      data: {
        userId,
        token: hashedOTP,
        type: 'TWO_FACTOR',
        expiresAt,
      },
    });

    // Send OTP via email
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

  // Verify the OTP
  async verifyOTP(userId: string, otp: string): Promise<boolean> {
    const hashedOTP = this.hashOTP(otp);

    const verificationToken = await prisma.verificationToken.findFirst({
      where: {
        userId,
        token: hashedOTP,
        type: 'TWO_FACTOR',
        expiresAt: { gt: new Date() },
        isUsed: false,
      },
    });

    if (!verificationToken) {
      return false;
    }

    // Mark as used
    await prisma.verificationToken.update({
      where: { id: verificationToken.id },
      data: { isUsed: true },
    });

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
