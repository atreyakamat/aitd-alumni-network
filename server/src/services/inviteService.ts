import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { sendEmail } from '../utils/email';
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

export const MAX_BULK_INVITES = 50;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHAREABLE_EMAIL = 'shareable-link';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-f0-9]{64}$/i;

export const normalizeEmail = (email: unknown): string | null => {
  if (typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length <= 254 && EMAIL_RE.test(trimmed) ? trimmed : null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export class InviteService {
  /** Pause between bulk sends to stay under the mail provider's rate limit. */
  bulkDelayMs = 100;

  // Generate a unique, unguessable invite token (256 bits of CSPRNG output)
  generateToken(): string {
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
    // Everything user-supplied is escaped before it is interpolated into HTML
    inviterName = escapeHtml(inviterName || '');
    inviteeName = inviteeName ? escapeHtml(inviteeName) : undefined;
    customMessage = customMessage ? escapeHtml(customMessage) : undefined;
    const greeting = inviteeName ? `Hi ${inviteeName}` : 'Hello';
    const batchInfo = batchYear ? ` (Class of ${Number(batchYear)})` : '';
    
    return `
      <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #002045 0%, #004488 100%); padding: 40px 30px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 300;">AIEM Connection</h1>
          <p style="color: #b45309; margin: 10px 0 0; font-size: 14px; letter-spacing: 1px;">AIEM ALUMNI NETWORK</p>
        </div>
        
        <!-- Content -->
        <div style="padding: 40px 30px;">
          <h2 style="color: #002045; margin: 0 0 20px; font-size: 24px;">${greeting}${batchInfo},</h2>
          
          <p style="color: #64748b; line-height: 1.8; margin: 0 0 20px;">
            <strong style="color: #002045;">${inviterName}</strong> has invited you to join AIEM Connection – 
            the exclusive networking platform for AIEM alumni.
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
              Join AIEM Connection
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
            © ${new Date().getFullYear()} AIEM Alumni Association
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
    const email = normalizeEmail(data?.email);
    if (!email) {
      return { success: false, error: 'Invalid email address' };
    }

    let createdInviteId: string | undefined;
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
        where: { email },
        select: { id: true },
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
          email,
          isShareable: false,
          createdAt: { gte: new Date(Date.now() - INVITE_TTL_MS) }, // Last 7 days
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
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      const invite = await prisma.invite.create({
        data: {
          email,
          name: data.name,
          batchYear: data.batchYear,
          token,
          expiresAt,
          inviterId,
          metadata: {
            batchYear: data.batchYear,
            message: data.message,
          },
        },
      });
      createdInviteId = invite.id;

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
        to: email,
        subject: `${inviter.fullName} invited you to join AIEM Connection`,
        html: emailHtml,
      });

      // Update invite status
      const sent = await prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'SENT' },
      });

      return { success: true, invite: sent ?? { ...invite, status: 'SENT' } };
    } catch (error: any) {
      console.error('Failed to send invite:', error);
      // Don't leave an unsent invite behind: it would block a retry for 7 days
      if (createdInviteId) {
        await prisma.invite.delete({ where: { id: createdInviteId } }).catch(() => undefined);
      }
      return {
        success: false,
        error: error?.message || 'Failed to send invitation',
      };
    }
  }

  /**
   * Bulk invite (CSV upload). At most MAX_BULK_INVITES rows; invalid and
   * duplicate (case-insensitive) e-mails are reported as failures, not sent.
   */
  async sendBulkInvites(
    inviterId: string,
    invites: InviteInput[]
  ): Promise<BulkInviteResult> {
    if (!Array.isArray(invites) || invites.length === 0) {
      throw new AppError('Invites array is required', 400, 'MISSING_INVITES');
    }
    if (invites.length > MAX_BULK_INVITES) {
      throw new AppError(`Maximum ${MAX_BULK_INVITES} invites per batch`, 400, 'TOO_MANY_INVITES');
    }

    const result: BulkInviteResult = {
      total: invites.length,
      sent: 0,
      failed: 0,
      errors: [],
    };

    const seen = new Set<string>();
    let first = true;

    for (const invite of invites) {
      const rawEmail = typeof invite?.email === 'string' ? invite.email : String(invite?.email ?? '');
      const email = normalizeEmail(invite?.email);

      if (!email) {
        result.failed++;
        result.errors.push({ email: rawEmail, error: 'Invalid email address' });
        continue;
      }
      if (seen.has(email)) {
        result.failed++;
        result.errors.push({ email: rawEmail, error: 'Duplicate email in batch' });
        continue;
      }
      seen.add(email);

      // Small delay between sends to avoid provider rate limiting
      if (!first && this.bulkDelayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, this.bulkDelayMs));
      }
      first = false;

      const sendResult = await this.sendInvite(inviterId, { ...invite, email });

      if (sendResult.success) {
        result.sent++;
      } else {
        result.failed++;
        result.errors.push({
          email: rawEmail,
          error: sendResult.error || 'Unknown error',
        });
      }
    }

    return result;
  }

  /** Loads an invite by token and rejects unknown, expired or already-used ones. */
  private async loadUsableInvite(token: string, include?: Record<string, unknown>) {
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      throw new AppError('Invalid invitation', 404, 'INVALID_INVITE');
    }

    const invite: any = await prisma.invite.findUnique({
      where: { token },
      ...(include ? { include } : {}),
    });

    if (!invite) {
      throw new AppError('Invalid invitation', 404, 'INVALID_INVITE');
    }

    if (invite.expiresAt < new Date() || invite.status === 'EXPIRED') {
      throw new AppError('Invitation has expired', 400, 'EXPIRED_INVITE');
    }

    if (!invite.isShareable && invite.status === 'ACCEPTED') {
      throw new AppError('Invitation has already been used', 400, 'USED_INVITE');
    }

    return invite;
  }

  // Verify invite token and get invite details
  async verifyInvite(token: string) {
    const invite = await this.loadUsableInvite(token, {
      inviter: {
        select: { fullName: true, profilePhotoUrl: true, batchYear: true },
      },
    });

    return {
      email: invite.isShareable ? null : invite.email,
      name: invite.name,
      isShareable: !!invite.isShareable,
      inviter: invite.inviter,
      metadata: invite.metadata,
    };
  }

  /**
   * Accept an invite as `userId`.
   *  - Direct invites: only the invited e-mail may accept, and only once.
   *  - Shareable links: any member except the inviter may use them until expiry.
   * A connection between inviter and invitee is created if none exists.
   */
  async acceptInvite(token: string, userId: string) {
    const invite = await this.loadUsableInvite(token);

    if (invite.inviterId && invite.inviterId === userId) {
      throw new AppError('You cannot accept your own invitation', 400, 'SELF_INVITE');
    }

    if (!invite.isShareable) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!user || normalizeEmail(user.email) !== normalizeEmail(invite.email)) {
        throw new AppError('This invitation was sent to a different email address', 403, 'INVITE_EMAIL_MISMATCH');
      }

      // Atomic single use: only one request can flip a not-yet-accepted invite
      const { count } = await prisma.invite.updateMany({
        where: { id: invite.id, status: { not: 'ACCEPTED' } },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });
      if (count !== 1) {
        throw new AppError('Invitation has already been used', 400, 'USED_INVITE');
      }
    }

    // Create connection between inviter and invitee (unless one already exists)
    if (invite.inviterId) {
      const existing = await prisma.connection.findFirst({
        where: {
          OR: [
            { requesterId: invite.inviterId, addresseeId: userId },
            { requesterId: userId, addresseeId: invite.inviterId },
          ],
        },
      });

      if (!existing) {
        await prisma.connection.create({
          data: {
            requesterId: invite.inviterId,
            addresseeId: userId,
            status: 'ACCEPTED',
          },
        });
      }
    }

    return { message: 'Invitation accepted' };
  }

  // Get the caller's own sent (direct) invites; tokens are never returned
  async getSentInvites(userId: string, page: number = 1, limit: number = 20) {
    const pg = paginationHelper(page, limit);
    const where = { inviterId: userId, isShareable: false };

    const [invites, total] = await Promise.all([
      prisma.invite.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          batchYear: true,
          status: true,
          expiresAt: true,
          acceptedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.invite.count({ where }),
    ]);

    return buildPaginationResponse(invites, total, pg.page, pg.limit);
  }

  // Invite stats for the caller's own direct invites (shareable links excluded)
  async getInviteStats(userId: string) {
    const base = { inviterId: userId, isShareable: false };
    const now = new Date();
    const [total, accepted, pending, expired] = await Promise.all([
      prisma.invite.count({ where: base }),
      prisma.invite.count({ where: { ...base, status: 'ACCEPTED' } }),
      prisma.invite.count({ where: { ...base, status: { in: ['PENDING', 'SENT'] }, expiresAt: { gte: now } } }),
      prisma.invite.count({ where: { ...base, status: { not: 'ACCEPTED' }, expiresAt: { lt: now } } }),
    ]);

    return {
      total,
      accepted,
      pending,
      expired,
      conversionRate: total > 0 ? Math.round((accepted / total) * 100) : 0,
    };
  }

  // Generate (or reuse a still-valid) shareable invite link
  async generateShareableLink(userId: string) {
    const existing = await prisma.invite.findFirst({
      where: {
        inviterId: userId,
        isShareable: true,
        // Reuse only if it still has more than a day of life left
        expiresAt: { gt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: 'desc' },
    });

    let token: string;
    let expiresAt: Date;
    if (existing) {
      token = existing.token;
      expiresAt = existing.expiresAt;
    } else {
      token = this.generateToken();
      expiresAt = new Date(Date.now() + LINK_TTL_MS);
      await prisma.invite.create({
        data: {
          email: SHAREABLE_EMAIL,
          token,
          expiresAt,
          inviterId: userId,
          isShareable: true,
        },
      });
    }

    return {
      link: `${config.frontendUrl}/register?ref=${token}`,
      expiresAt,
    };
  }
}

export const inviteService = new InviteService();
