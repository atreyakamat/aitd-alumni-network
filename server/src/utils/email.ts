import nodemailer from 'nodemailer';
import { config } from '../config';
import { log } from './logger';

// A stuck mail server must not hold a request for minutes (registration waits for the verification mail): nodemailer's
// own defaults are 2 minutes to connect and 10 minutes of silence.
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

/**
 * Where mail goes. SendGrid (an API key) is used through its SMTP relay, so no extra dependency is needed; otherwise the
 * configured SMTP server; with neither, null: development just prints the mail.
 */
export const buildTransportOptions = (email: typeof config.email = config.email) => {
  if (email.sendgridApiKey) {
    return { host: 'smtp.sendgrid.net', port: 587, secure: false, auth: { user: 'apikey', pass: email.sendgridApiKey }, ...TIMEOUTS };
  }
  if (email.smtp.user && email.smtp.pass) {
    return {
      host: email.smtp.host,
      port: email.smtp.port,
      secure: email.smtp.port === 465,
      auth: { user: email.smtp.user, pass: email.smtp.pass },
      ...TIMEOUTS,
    };
  }
  return null;
};

const transportOptions = buildTransportOptions();
const transporter = transportOptions ? nodemailer.createTransport(transportOptions) : null;

const TRANSIENT_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ETIMEOUT', 'ESOCKET', 'ECONNRESET', 'EDNS']);

/** Worth another try: the network or the server had a bad moment (a 4xx SMTP reply means "try again later"). */
export const isTransientMailError = (error: unknown): boolean => {
  const e = error as { code?: unknown; responseCode?: unknown } | undefined;
  if (!e) return false;
  if (typeof e.code === 'string' && TRANSIENT_CODES.has(e.code)) return true;
  return typeof e.responseCode === 'number' && e.responseCode >= 400 && e.responseCode < 500;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `send`, retrying transient failures with a growing pause. A rejected recipient or bad login is not retried. */
export const sendWithRetry = async <T>(
  send: () => Promise<T>,
  { retries = 2, baseDelayMs = 500, sleep = defaultSleep }: { retries?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<T> => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= retries || !isTransientMailError(error)) throw error;
      await sleep(baseDelayMs * (attempt === 0 ? 1 : 3 ** attempt));
    }
  }
};

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** e.g. a PDF receipt for a guest donor. */
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  if (!transporter) {
    console.log('--------------------------------------------------');
    console.log('📧 DEVELOPMENT EMAIL LOG');
    console.log(`To: ${options.to}`);
    console.log(`Subject: ${options.subject}`);
    console.log('Content (HTML):');
    console.log(options.html);
    console.log('--------------------------------------------------');
    return;
  }

  try {
    await sendWithRetry(() =>
      transporter.sendMail({
        from: config.email.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
        attachments: options.attachments,
      })
    );
    log.info('E-mail sent', { subject: options.subject });
  } catch (error) {
    log.error('Sending e-mail failed', { subject: options.subject, err: error });
    // Don't throw error in development to avoid crashing the flow
    if (config.nodeEnv === 'production') {
      throw error;
    }
  }
};

/** Every user-controlled value placed in an HTML email goes through this. */
const escapeEmailHtml = (value: string) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Names inside Subject lines: no line breaks (header injection), no angle brackets, bounded length. */
const headerSafe = (value: string) =>
  // eslint-disable-next-line no-control-regex
  String(value).replace(/[\x00-\x1f\x7f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

export const sendVerificationEmail = async (
  email: string,
  name: string,
  token: string
): Promise<void> => {
  const verificationUrl = `${config.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
  
  await sendEmail({
    to: email,
    subject: 'Verify your AIEM Connect account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">Welcome to AIEM Connect!</h1>
        <p>Hi ${escapeEmailHtml(name)},</p>
        <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
        <a href="${verificationUrl}" 
           style="display: inline-block; background-color: #0B2A5B; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Verify Email
        </a>
        <p>Or copy and paste this link in your browser:</p>
        <p style="color: #666;">${verificationUrl}</p>
        <p>This link will expire in 24 hours.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">
          If you didn't create an account, please ignore this email.
        </p>
      </div>
    `,
  });
};

export const sendPasswordResetEmail = async (
  email: string,
  name: string,
  token: string
): Promise<void> => {
  const resetUrl = `${config.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
  
  await sendEmail({
    to: email,
    subject: 'Reset your AIEM Connect password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">Password Reset</h1>
        <p>Hi ${escapeEmailHtml(name)},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <a href="${resetUrl}" 
           style="display: inline-block; background-color: #0B2A5B; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Reset Password
        </a>
        <p>Or copy and paste this link in your browser:</p>
        <p style="color: #666;">${resetUrl}</p>
        <p>This link will expire in 1 hour.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">
          If you didn't request a password reset, please ignore this email or contact support.
        </p>
      </div>
    `,
  });
};

/** Sent when an administrator has approved the registration: this is the moment the account becomes usable. */
export const sendWelcomeEmail = async (
  email: string,
  name: string
): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'Your AIEM Connect registration is approved',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">Welcome to AIEM Connect!</h1>
        <p>Hi ${escapeEmailHtml(name)},</p>
        <p>An administrator has checked your registration and approved it. You can sign in now.</p>
        <p>Here's what you can do:</p>
        <ul>
          <li>Complete your profile to connect with other alumni</li>
          <li>Explore the alumni directory</li>
          <li>Post updates on the notice board</li>
          <li>Find career opportunities</li>
          <li>Join events and chapters</li>
        </ul>
        <a href="${config.frontendUrl}/login" 
           style="display: inline-block; background-color: #0B2A5B; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Sign in
        </a>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">
          © AIEM Connect. All rights reserved.
        </p>
      </div>
    `,
  });
};

/** Sent once the e-mail address is verified: the registration now waits for an administrator. */
export const sendApplicationReceivedEmail = async (email: string, name: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'We received your AIEM Connect registration',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">Your registration is being reviewed</h1>
        <p>Hi ${escapeEmailHtml(name)},</p>
        <p>Thank you for verifying your e-mail address. AIEM Connect is for alumni of the college only, so an
        administrator checks every registration before it is approved.</p>
        <p>You do not need to do anything. We will e-mail you as soon as the review is done; you can sign in after that.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">© AIEM Connect. All rights reserved.</p>
      </div>
    `,
  });
};

/** Sent to the college administrator when a registration is ready for review. Everything about the applicant was typed by a stranger. */
export const sendNewRegistrationEmail = async (
  to: string,
  applicant: { fullName: string; batchYear: number; department: string }
): Promise<void> => {
  await sendEmail({
    to,
    subject: `New registration to review: ${headerSafe(applicant.fullName)}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">A registration is waiting for your review</h1>
        <p><strong>${escapeEmailHtml(applicant.fullName)}</strong> has asked to join AIEM Connect.</p>
        <ul>
          <li>Batch: ${escapeEmailHtml(String(applicant.batchYear))}</li>
          <li>Department: ${escapeEmailHtml(applicant.department)}</li>
        </ul>
        <p>Please check that the person is an alumnus of the college, then approve or reject the registration.
        Nobody can sign in before an administrator has approved it.</p>
        <a href="${config.frontendUrl}/admin/approvals"
           style="display: inline-block; background-color: #0B2A5B; color: white; padding: 12px 24px;
                  text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Review registrations
        </a>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">© AIEM Connect. All rights reserved.</p>
      </div>
    `,
  });
};

/** Sent when an administrator did not approve the registration. The reason is the administrator's own words, so it is escaped. */
export const sendRejectionEmail = async (email: string, name: string, reason: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'Your AIEM Connect registration was not approved',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">Your registration was not approved</h1>
        <p>Hi ${escapeEmailHtml(name)},</p>
        <p>An administrator reviewed your registration and could not approve it.</p>
        <p style="background: #f6f7f9; padding: 12px 16px; border-radius: 6px;">${escapeEmailHtml(reason)}</p>
        <p>If you think this is a mistake, reply to the alumni office with the details that show you studied at the college.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">© AIEM Connect. All rights reserved.</p>
      </div>
    `,
  });
};

export const sendPasswordChangedEmail = async (email: string, name: string): Promise<void> => {
  const resetUrl = `${config.frontendUrl}/forgot-password`;
  await sendEmail({
    to: email,
    subject: 'Your AIEM Connect password was changed',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">Password changed</h1>
        <p>Hi ${escapeEmailHtml(name)},</p>
        <p>The password for your AIEM Connect account was just changed, and every other device was signed out.</p>
        <p>If this was you, no further action is needed.</p>
        <p><strong>If you did not make this change</strong>, reset your password immediately and contact support:</p>
        <a href="${resetUrl}"
           style="display: inline-block; background-color: #0B2A5B; color: white; padding: 12px 24px;
                  text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Reset Password
        </a>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">This is an automated security notice.</p>
      </div>
    `,
    text: `Hi ${name}, the password for your AIEM Connect account was just changed and every other device was signed out. If this was not you, reset your password immediately at ${resetUrl} and contact support.`,
  });
};

export const sendInviteEmail = async (
  email: string,
  inviterName: string,
  token: string
): Promise<void> => {
  const inviteUrl = `${config.frontendUrl}/register?invite=${encodeURIComponent(token)}`;
  
  await sendEmail({
    to: email,
    subject: `${headerSafe(inviterName)} invited you to join AIEM Connect`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0B2A5B;">You're Invited!</h1>
        <p>${escapeEmailHtml(inviterName)} has invited you to join the AIEM Connect network.</p>
        <p>Connect with fellow alumni, explore career opportunities, and stay updated with events.</p>
        <a href="${inviteUrl}" 
           style="display: inline-block; background-color: #0B2A5B; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Accept Invitation
        </a>
        <p>Or copy and paste this link in your browser:</p>
        <p style="color: #666;">${inviteUrl}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">
          This invitation will expire in 7 days.
        </p>
      </div>
    `,
  });
};
