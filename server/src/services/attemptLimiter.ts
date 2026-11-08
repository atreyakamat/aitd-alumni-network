import crypto from 'crypto';
import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';

/**
 * Per-account budget for guessable secrets (OTP codes, the current password re-checked by
 * sensitive endpoints). Unlike the per-IP express-rate-limit, it cannot be sidestepped by
 * rotating addresses, and it holds under concurrency: the attempt is *reserved* (a row is
 * written) BEFORE the secret is checked, so a burst of parallel guesses cannot all observe
 * a low failure count. Rows live in `VerificationToken` (type = the bucket name) and expire
 * on their own; a successful check clears the bucket.
 */

export const PASSWORD_FAILURE_TYPE = 'PASSWORD_FAILURE';
/** Wrong current-password guesses allowed per account inside the window. */
export const PASSWORD_MAX_ATTEMPTS = 5;
export const PASSWORD_LOCKOUT_MINUTES = 15;

/**
 * Reserve one attempt. Throws `AppError(429, code)` when the bucket is already spent; the
 * reservation made by a refused attempt is removed again so hammering a locked account does
 * not extend its lockout.
 */
export const reserveAttempt = async (
  userId: string,
  type: string,
  max: number,
  windowMinutes: number,
  refusal: { message: string; code: string }
): Promise<void> => {
  const reservation = await prisma.verificationToken.create({
    data: {
      userId,
      type,
      // Opaque and unique: these rows only count attempts
      token: `${type}:${crypto.randomUUID()}`,
      expiresAt: new Date(Date.now() + windowMinutes * 60 * 1000),
    },
    select: { id: true },
  });

  const used = await prisma.verificationToken.count({
    where: { userId, type, expiresAt: { gt: new Date() } },
  });
  if (used > max) {
    await prisma.verificationToken.delete({ where: { id: reservation.id } }).catch(() => undefined);
    throw new AppError(refusal.message, 429, refusal.code);
  }
};

export const clearAttempts = async (userId: string, type: string): Promise<void> => {
  await prisma.verificationToken.deleteMany({ where: { userId, type } });
};

/**
 * Check `password` against `hash` under the per-account budget. Resolves true/false for a
 * checked guess; rejects with 429 PASSWORD_ATTEMPTS_EXCEEDED once the budget is spent.
 */
export const checkPasswordWithBudget = async (
  userId: string,
  verify: () => Promise<boolean>
): Promise<boolean> => {
  await reserveAttempt(userId, PASSWORD_FAILURE_TYPE, PASSWORD_MAX_ATTEMPTS, PASSWORD_LOCKOUT_MINUTES, {
    message: 'Too many incorrect password attempts. Please try again later.',
    code: 'PASSWORD_ATTEMPTS_EXCEEDED',
  });
  const ok = await verify();
  if (ok) await clearAttempts(userId, PASSWORD_FAILURE_TYPE);
  return ok;
};
