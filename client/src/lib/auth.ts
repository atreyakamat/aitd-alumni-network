import { z } from 'zod';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';

/**
 * Password policy mirrored from the server: 8–128 chars with at least one
 * uppercase letter, one lowercase letter and one digit.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const PASSWORD_MAX_LENGTH = 128;

/** The same policy as `passwordSchema`, as individual rules for live UI hints. */
export const PASSWORD_RULES = [
  { id: 'length', label: `At least 8 characters (max ${PASSWORD_MAX_LENGTH})`, test: (pw: string) => pw.length >= 8 && pw.length <= PASSWORD_MAX_LENGTH },
  { id: 'uppercase', label: 'One uppercase letter', test: (pw: string) => /[A-Z]/.test(pw) },
  { id: 'lowercase', label: 'One lowercase letter', test: (pw: string) => /[a-z]/.test(pw) },
  { id: 'number', label: 'One number', test: (pw: string) => /[0-9]/.test(pw) },
] as const;

export function evaluatePasswordRules(password: string) {
  return PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(password) }));
}

/** 2FA errors after which the login challenge must be restarted. */
export const RESTART_2FA_CODES = new Set(['INVALID_2FA_SESSION', 'OTP_ATTEMPTS_EXCEEDED']);

export function shouldRestart2FA(err: unknown): boolean {
  const code = getApiErrorCode(err);
  return !!code && RESTART_2FA_CODES.has(code);
}

/** Friendly messages for auth/2FA error codes; falls back to the server message. */
export function getAuthErrorMessage(err: unknown, fallback: string): string {
  switch (getApiErrorCode(err)) {
    case 'INVALID_OTP':
      return 'That code is invalid or has expired. Check your email and try again.';
    case 'OTP_ATTEMPTS_EXCEEDED':
      return 'Too many incorrect codes. Please sign in again to get a new code.';
    case 'OTP_RESEND_TOO_SOON':
      return 'Please wait a moment before requesting another code.';
    case 'INVALID_2FA_SESSION':
      return 'Your verification session has expired. Please sign in again.';
    default:
      return getApiErrorMessage(err, fallback);
  }
}
