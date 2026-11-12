import bcrypt from 'bcryptjs';
import { AppError } from '../middleware/errorHandler';

const SALT_ROUNDS = 12;

/** bcrypt only ever reads the first 72 BYTES of its input; anything after that is silently ignored. */
export const MAX_PASSWORD_BYTES = 72;
/** Longer attempts are rejected without touching bcrypt (cheap guard against oversized login bodies). */
const MAX_COMPARE_LENGTH = 1024;

/**
 * Passwords that satisfy the length + upper/lower/digit rule but sit at the top of every
 * breach list. Compared case-insensitively after dropping trailing punctuation.
 */
const COMMON_PASSWORDS = new Set([
  'password1', 'password12', 'password123', 'password1234', 'passw0rd', 'passw0rd1', 'passw0rd123',
  'qwerty123', 'qwerty1234', 'qwerty12345', 'qwertyuiop1', 'welcome1', 'welcome12', 'welcome123',
  'admin123', 'admin1234', 'administrator1', 'letmein1', 'letmein123', 'iloveyou1', 'iloveyou123',
  'abc12345', 'abcd1234', 'abcd12345', 'abcde12345', 'monkey123', 'dragon123', 'football1', 'football123',
  'baseball1', 'sunshine1', 'princess1', 'master123', 'login123', 'changeme1', 'changeme123',
  'aiem1234', 'aiem12345', 'aiem123', 'aiemconnect1', 'aiemalumni1', 'aitd1234', 'aitd12345', 'aitd123', 'aitdconnection1', 'aitdalumni1',
  'alumni123', 'student123',
  '1q2w3e4r5t', 'a1b2c3d4', 'zaq12wsx', '1qaz2wsx', 'p@ssw0rd', 'p@ssword1', 'trustno1', 'abc123456',
]);

const tooLong = () =>
  // Hashing a longer value would quietly drop the tail, so two different passwords would collide
  new AppError(
    `Password must be at most ${MAX_PASSWORD_BYTES} bytes (multi-byte characters count as several)`,
    400,
    'PASSWORD_TOO_LONG'
  );

export const hashPassword = async (password: string): Promise<string> => {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw tooLong();
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  if (typeof password !== 'string' || password.length > MAX_COMPARE_LENGTH) return false;
  return bcrypt.compare(password, hash);
};

/**
 * What the deny-list and the e-mail rule compare: the password the way a person would read it. Compatibility forms
 * (full-width letters, ligatures, long s) are folded by NFKC, accents and combining marks are dropped, invisible format
 * characters (zero-width space and joiners, soft hyphen, bidi marks) are removed, and case is folded. Used for the POLICY
 * check only: what is hashed and compared at login is the exact string the member typed, so existing hashes keep working.
 */
export const policyForm = (value: string): string =>
  value
    .normalize('NFKC')
    .normalize('NFKD')
    .replace(/[\p{M}\p{Cf}]+/gu, '')
    .toLowerCase();

/**
 * Policy checks beyond the schema's length/character-class rule: reject breach-list staples
 * and passwords that are just the account's own e-mail (or its local part).
 */
export const assertPasswordAllowed = (password: string, email?: string): void => {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw tooLong();
  const folded = policyForm(password);
  const normalised = folded.replace(/[^a-z0-9]+$/, '');
  const foldedEmail = email ? policyForm(email.trim()) : '';
  const local = foldedEmail.split('@')[0];
  const isOwnEmail = !!email && (folded === foldedEmail || (local.length >= 6 && normalised === local));

  if (COMMON_PASSWORDS.has(normalised) || COMMON_PASSWORDS.has(folded) || isOwnEmail) {
    throw new AppError('This password is too common or easy to guess. Please choose another.', 400, 'WEAK_PASSWORD');
  }
};
