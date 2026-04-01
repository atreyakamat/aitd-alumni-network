import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { sendEmail, sendInviteEmail } from '../utils/email';
import { config } from '../config';
import crypto from 'crypto';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';

interface InviteInput {
  email: string;
  name?: string;
  batchYear?: number;
  message?: string;
}

interface BulkInviteResult {
  total: number;
  sent: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}

export class InviteService {
  // Generate a unique invite token
  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  // Generate a branded invite email HTML
  private generateBrandedEmail(
    inviterName: string,
    inviteeName: string | undefined,
    batchYear: number | undefined,
    customMessage: string | undefined,
    inviteUrl: string
  ): string {
    const greeting = inviteeName ? `Hi ${inviteeName}` : 'Hello';
    const batchInfo = batchYear ? ` (Class of ${batchYear})` : '';
    
    return `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #002045 0%, #004488 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 300;">AITD Connection</h1>
          <p style="color: #b45309; margin: 10px 0 0; font-size: 14px; letter-spacing: 1px;">AITD ALUMNI NETWORK</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 40px 30px;">
          <h2 style="color: #002045; margin: 0 0 20px; font-size: 24px;">${greeting}${batchInfo},</h2>
          
          <p style="color: #64748b; line-height: 1.8; margin: 0 0 20px;">
            <strong style="color: #002045;">${inviterName}</strong> has invited you to join AITD Connection – 
            the exclusive networking platform for AITD alumni.
          </p>
          
          ${customMessage ? `
            <div style="background: #f8fafc; border-left: 4px solid #b45309; padding: 15px 20px; margin: 20px 0;">
              <p style="color: #64748b; margin: 0; font-style: italic;">"${customMessage}"</p>
              <p style="color: #94a3b8; margin: 10px 0 0; font-size: 14px;">— ${inviterName}</p>
            </div>
          ` : ''}
          
          <p style="color: #64748b; line-height: 1.8; margin: 20px 0;">
            Join our vibrant community to:
          </p>
          
          <ul style="color: #64748b; line-height: 2; margin: 0 0 30px; padding-left: 20px;">
            <li>Reconnect with classmates and batchmates</li>
            <li>Access exclusive job opportunities</li>
            <li>Attend reunions and networking events</li>
            <li>Mentor current students</li>
            <li>Contribute to institutional growth</li>
          </ul>
          
          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #002045 0%, #004488 100%); 
                      color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; 
                      font-weight: 600; font-size: 16px; box-shadow: 0 4px 15px rgba(0, 32, 69, 0.3);">
              Join AITD Connection
            </a>
          </div>
          
          <p style="color: #94a3b8; text-align: center; font-size: 14px; margin: 20px 0 0;">
            Or copy this link: <a href="${inviteUrl}" style="color: #b45309;">${inviteUrl}</a>
          </p>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            This invitation expires in 7 days.<br>
            If you didn't expect this email, you can safely ignore it.
          </p>
          <p style="color: #94a3b8; font-size: 12px; margin: 10px 0 0;">
            © ${new Date().getFullYear()} AITD Alumni Association
          </p>
        </div>
      </div>
    `;
  }

  // Send a single invite
  async sendInvite(
    inviterId: string,
    data: InviteInput
  ): Promise<{ success: boolean; invite?: any; error?: string }> {
    try {
      // Get inviter info
      const inviter = await prisma.user.findUnique({
        where: { id: inviterId },
        select: { fullName: true, email: true },
      });

      if (!inviter) {
        throw new AppError('Inviter not found', 404, 'NOT_FOUND');
      }

      // Check if email is already a user
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
      });

      if (existingUser) {
        return {
          success: false,
          error: 'This email is already registered',
        };
      }

      // Check if invite was already sent recently
      const existingInvite = await prisma.invite.findFirst({
        where: {
          email: data.email,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
        },
      });

      if (existingInvite) {
        return {
          success: false,
          error: 'An invitation was already sent to this email recently',
        };
      }

      // Generate token and create invite
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const invite = await prisma.invite.create({
        data: {
          email: data.email,
          name: data.name,
          token,
          expiresAt,
          inviterId,
          metadata: {
            batchYear: data.batchYear,
            message: data.message,
          },
        },
      });

      // Send branded email
      const inviteUrl = `${config.frontendUrl}/register?invite=${token}`;
      const emailHtml = this.generateBrandedEmail(
        inviter.fullName,
        data.name,
        data.batchYear,
        data.message,
        inviteUrl
      );

      await sendEmail({
        to: data.email,
        subject: `${inviter.fullName} invited you to join AITD Connection`,
        html: emailHtml,
      });

      // Update invite status
      await prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'SENT' },
      });

      return { success: true, invite };
    } catch (error: any) {
      console.error('Failed to send invite:', error);
      return {
        success: false,
        error: error.message || 'Failed to send invitation',
      };
    }
  }

  // Bulk invite from CSV data
  async sendBulkInvites(
    inviterId: string,
    invites: InviteInput[]
  ): Promise<BulkInviteResult> {
    const result: BulkInviteResult = {
      total: invites.length,
      sent: 0,
      failed: 0,
      errors: [],
    };

    for (const invite of invites) {
      const sendResult = await this.sendInvite(inviterId, invite);
      
      if (sendResult.success) {
        result.sent++;
      } else {
        result.failed++;
        result.errors.push({
          email: invite.email,
          error: sendResult.error || 'Unknown error',
        });
      }

      // Add small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return result;
  }

  // Verify invite token and get invite details
  async verifyInvite(token: string) {
    const invite = await prisma.invite.findUnique({
      where: { token },
      include: {
        inviter: {
          select: { fullName: true, profilePhotoUrl: true, batchYear: true },
        },
      },
    });

    if (!invite) {
      throw new AppError('Invalid invitation', 404, 'INVALID_INVITE');
    }

    if (invite.expiresAt < new Date()) {
      throw new AppError('Invitation has expired', 400, 'EXPIRED_INVITE');
    }

    if (invite.status === 'ACCEPTED') {
      throw new AppError('Invitation has already been used', 400, 'USED_INVITE');
    }

    return {
      email: invite.email,
      name: invite.name,
      inviter: invite.inviter,
      metadata: invite.metadata,
    };
  }

  // Mark invite as accepted
  async acceptInvite(token: string, userId: string) {
    const invite = await prisma.invite.findUnique({ where: { token } });

    if (!invite) {
      throw new AppError('Invalid invitation', 404, 'INVALID_INVITE');
    }

    await prisma.invite.update({
      where: { id: invite.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: new Date(),
      },
    });

    // Create connection between inviter and invitee
    if (invite.inviterId) {
      await prisma.connection.create({
        data: {
          requesterId: invite.inviterId,
          addresseeId: userId,
          status: 'ACCEPTED',
        },
      });
    }

    return { message: 'Invitation accepted' };
  }

  // Get user's sent invites
  async getSentInvites(userId: string, page: number = 1, limit: number = 20) {
    const { skip, take } = paginationHelper(page, limit);

    const [invites, total] = await Promise.all([
      prisma.invite.findMany({
        where: { inviterId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.invite.count({ where: { inviterId: userId } }),
    ]);

    return buildPaginationResponse(invites, total, page, limit);
  }

  // Get invite stats for a user
  async getInviteStats(userId: string) {
    const [total, accepted, pending] = await Promise.all([
      prisma.invite.count({ where: { inviterId: userId } }),
      prisma.invite.count({ where: { inviterId: userId, status: 'ACCEPTED' } }),
      prisma.invite.count({ where: { inviterId: userId, status: 'SENT' } }),
    ]);

    return {
      total,
      accepted,
      pending,
      conversionRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
    };
  }

  // Generate a shareable invite link
  async generateShareableLink(userId: string) {
    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.invite.create({
      data: {
        email: 'shareable-link',
        token,
        expiresAt,
        inviterId: userId,
        isShareable: true,
      },
    });

    return {
      link: `${config.frontendUrl}/register?ref=${token}`,
      expiresAt,
    };
  }
}

export const inviteService = new InviteService();
