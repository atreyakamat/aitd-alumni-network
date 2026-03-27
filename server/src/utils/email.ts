import nodemailer from 'nodemailer';
import { config } from '../config';

const transporter = nodemailer.createTransport({
  host: config.email.smtp.host,
  port: config.email.smtp.port,
  secure: config.email.smtp.port === 465,
  auth: {
    user: config.email.smtp.user,
    pass: config.email.smtp.pass,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const sendEmail = async (options: EmailOptions): Promise<void> => {
  try {
    await transporter.sendMail({
      from: config.email.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
    console.log(`Email sent to ${options.to}`);
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
};

export const sendVerificationEmail = async (
  email: string,
  name: string,
  token: string
): Promise<void> => {
  const verificationUrl = `${config.frontendUrl}/verify-email?token=${token}`;
  
  await sendEmail({
    to: email,
    subject: 'Verify your Alumni Connect account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0A66C2;">Welcome to Alumni Connect!</h1>
        <p>Hi ${name},</p>
        <p>Thank you for registering. Please verify your email address by clicking the button below:</p>
        <a href="${verificationUrl}" 
           style="display: inline-block; background-color: #0A66C2; color: white; padding: 12px 24px; 
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
  const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;
  
  await sendEmail({
    to: email,
    subject: 'Reset your Alumni Connect password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0A66C2;">Password Reset</h1>
        <p>Hi ${name},</p>
        <p>We received a request to reset your password. Click the button below to create a new password:</p>
        <a href="${resetUrl}" 
           style="display: inline-block; background-color: #0A66C2; color: white; padding: 12px 24px; 
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

export const sendWelcomeEmail = async (
  email: string,
  name: string
): Promise<void> => {
  await sendEmail({
    to: email,
    subject: 'Welcome to Alumni Connect!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0A66C2;">Welcome to Alumni Connect!</h1>
        <p>Hi ${name},</p>
        <p>Your email has been verified and your account is now active.</p>
        <p>Here's what you can do:</p>
        <ul>
          <li>Complete your profile to connect with other alumni</li>
          <li>Explore the alumni directory</li>
          <li>Post updates on the notice board</li>
          <li>Find career opportunities</li>
          <li>Join events and chapters</li>
        </ul>
        <a href="${config.frontendUrl}/dashboard" 
           style="display: inline-block; background-color: #0A66C2; color: white; padding: 12px 24px; 
                  text-decoration: none; border-radius: 6px; margin: 20px 0;">
          Go to Dashboard
        </a>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">
          © Alumni Connect. All rights reserved.
        </p>
      </div>
    `,
  });
};

export const sendInviteEmail = async (
  email: string,
  inviterName: string,
  token: string
): Promise<void> => {
  const inviteUrl = `${config.frontendUrl}/register?invite=${token}`;
  
  await sendEmail({
    to: email,
    subject: `${inviterName} invited you to join Alumni Connect`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #0A66C2;">You're Invited!</h1>
        <p>${inviterName} has invited you to join the Alumni Connect network.</p>
        <p>Connect with fellow alumni, explore career opportunities, and stay updated with events.</p>
        <a href="${inviteUrl}" 
           style="display: inline-block; background-color: #0A66C2; color: white; padding: 12px 24px; 
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
