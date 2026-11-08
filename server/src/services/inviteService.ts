import { Prisma } from '@prisma/client';
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
/** Direct invite e-mails one member may trigger per rolling 24 hours (the platform sends them). */
export const INVITE_DAILY_LIMIT = 100;
export const MAX_INVITE_NAME_LENGTH = 100;
export const MAX_INVITE_MESSAGE_LENGTH = 1000;
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHAREABLE_EMAIL = 'shareable-link';
// The WHATWG "valid e-mail address" grammar (ASCII). The previous /^[^\s@]+@[^\s@]+\.[^\s@]+$/ accepted anything with a
// single "@", including "a@b.com,c.d" (two recipients to nodemailer's parser), "Victim<v@x.com>.a" (delivered to v@x.com
// while the "already invited / already registered" checks looked at the whole odd string) and "a(x)@b.com".
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
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

  /** Direct invites the member has created in the last 24 hours. */
  private async invitesToday(inviterId: string, db: Pick<Prisma.TransactionClient, 'invite'> = prisma): Promise<number> {
    const count = await db.invite.count({
      where: { inviterId, isShareable: false, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    return count ?? 0;
  }

  private quotaError() {
    return new AppError(
      `You can send at most ${INVITE_DAILY_LIMIT} invitations per day. Try again later.`,
      429,
      'INVITE_LIMIT'
    );
  }

  /** Free-text fields are interpolated into an e-mail sent from our address: keep them short. */
  private fieldError(data: InviteInput): string | null {
    if (data.name !== undefined && data.name !== null && (typeof data.name !== 'string' || data.name.length > MAX_INVITE_NAME_LENGTH)) {
      return `Name must be at most ${MAX_INVITE_NAME_LENGTH} characters`;
    }
    if (
      data.message !== undefined &&
      data.message !== null &&
      (typeof data.message !== 'string' || data.message.length > MAX_INVITE_MESSAGE_LENGTH)
    ) {
      return `Message must be at most ${MAX_INVITE_MESSAGE_LENGTH} characters`;
    }
    return null;
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
    const fieldError = this.fieldError(data);
    if (fieldError) {
      return { success: false, error: fieldError };
    }
    if ((await this.invitesToday(inviterId)) >= INVITE_DAILY_LIMIT) {
      throw this.quotaError();
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

      // Generate token and create invite
      const token = this.generateToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

      // The daily quota and the "already invited" rule are "check, then insert": run them as one step per inviter,
      // otherwise a parallel burst reads the same low count (and finds no earlier invite) and every request passes.
      const reserved = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invite:${inviterId}`}))`;

        if ((await this.invitesToday(inviterId, tx)) >= INVITE_DAILY_LIMIT) return 'quota' as const;

        // Check if invite was already sent recently (to this address, by anybody)
        const existingInvite = await tx.invite.findFirst({
          where: {
            email,
            isShareable: false,
            createdAt: { gte: new Date(Date.now() - INVITE_TTL_MS) }, // Last 7 days
          },
        });
        if (existingInvite) return 'duplicate' as const;

        return tx.invite.create({
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
      });

      if (reserved === 'quota') throw this.quotaError();
      if (reserved === 'duplicate') {
        return {
          success: false,
          error: 'An invitation was already sent to this email recently',
        };
      }
      const invite = reserved;
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
        subject: `${inviter.fullName} invited you to join AITD Connection`,
        html: emailHtml,
      });

      // Update invite status
      const sent = await prisma.invite.update({
        where: { id: invite.id },
        data: { status: 'SENT' },
      });

      return { success: true, invite: sent ?? { ...invite, status: 'SENT' } };
    } catch (error: any) {
      // The quota is a rule of the request, not a failure of this one invitation
      if (error instanceof AppError && error.code === 'INVITE_LIMIT') throw error;
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

    // Refuse the whole batch up front instead of half-sending it
    if ((await this.invitesToday(inviterId)) + invites.length > INVITE_DAILY_LIMIT) {
      throw this.quotaError();
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

      let sendResult: Awaited<ReturnType<InviteService['sendInvite']>>;
      try {
        sendResult = await this.sendInvite(inviterId, { ...invite, email });
      } catch (error) {
        // A parallel request used up the quota meanwhile: report this invitation as not sent
        if (!(error instanceof AppError && error.code === 'INVITE_LIMIT')) throw error;
        sendResult = { success: false, error: error.message };
      }

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
      const userEmail = user ? normalizeEmail(user.email) : null;
      if (!userEmail || userEmail !== normalizeEmail(invite.email)) {
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
