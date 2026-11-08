/**
 * Database-side go-live checks, run by `npm run preflight` (never at request time).
 *
 * Looks for what a fresh production database must not contain: privileged accounts that still have a password from the
 * seed or the test helpers, demo accounts, and the absence of anybody who can administer the platform. Only the
 * account's e-mail address is ever reported, never a password or a hash.
 */
import type { Prisma } from '@prisma/client';
import { comparePassword } from '../utils/password';
import type { ConfigFinding } from './productionChecks';

/** Passwords that appear in this repository (seed script, test helpers, documentation). */
export const DEFAULT_PASSWORDS: readonly string[] = ['Admin@123', 'User@123', 'Str0ng!Passw0rd', 'Password123!', 'Admin@1234', 'admin123'];

export const DEMO_EMAILS: readonly string[] = Array.from({ length: 6 }, (_, i) => `user${i + 1}@example.com`);

interface UserRow {
  id: string;
  email: string;
  userRole: string;
  isActive: boolean;
  passwordHash: string | null;
}

/** The slice of the Prisma client this needs (keeps it testable without a database). */
export interface DatabaseLike {
  user: {
    findMany: (args: Prisma.UserFindManyArgs) => Promise<UserRow[]>;
    count: (args: Prisma.UserCountArgs) => Promise<number>;
  };
}

const finding = (code: string, message: string, fix: string): ConfigFinding => ({ code, level: 'error', waivable: false, message, fix });

export const findDatabaseProblems = async (db: DatabaseLike): Promise<ConfigFinding[]> => {
  const found: ConfigFinding[] = [];

  const risky = await db.user.findMany({
    where: {
      OR: [{ userRole: { not: 'MEMBER' } }, { email: { in: [...DEMO_EMAILS] } }, { email: { endsWith: '@aitd.test' } }],
    },
    select: { id: true, email: true, userRole: true, isActive: true, passwordHash: true },
  });

  const demo = risky.filter((u) => DEMO_EMAILS.includes(u.email) || u.email.endsWith('@aitd.test'));
  if (demo.length > 0) {
    found.push(
      finding(
        'DEMO_ACCOUNTS_PRESENT',
        `${demo.length} demo/test account(s) exist (${demo.map((u) => u.email).slice(0, 5).join(', ')}${demo.length > 5 ? ', ...' : ''}) with passwords that are in the repository.`,
        'Delete them (admin panel > Users, or DELETE FROM "User" WHERE email LIKE \'user_@example.com\') and never run the sample seed against production.'
      )
    );
  }

  const withDefaults: string[] = [];
  for (const user of risky) {
    if (!user.passwordHash) continue;
    for (const candidate of DEFAULT_PASSWORDS) {
      if (await comparePassword(candidate, user.passwordHash)) {
        withDefaults.push(user.email);
        break;
      }
    }
  }
  if (withDefaults.length > 0) {
    found.push(
      finding(
        'DEFAULT_CREDENTIALS',
        `Account(s) still use a password published in the repository: ${withDefaults.join(', ')}.`,
        'Sign in and change the password now (or use "Forgot password"); then rotate any sessions. Use SEED_ADMIN_PASSWORD (12+ random characters) for the first admin.'
      )
    );
  }

  const activeSuperAdmins = await db.user.count({ where: { userRole: 'SUPER_ADMIN', isActive: true } });
  if (activeSuperAdmins === 0) {
    found.push(
      finding(
        'NO_ACTIVE_SUPER_ADMIN',
        'There is no active super admin: nobody can manage users, roles or moderation.',
        'Start the API once with SEED_ON_START=true and SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD set (the seed is idempotent).'
      )
    );
  }

  return found;
};
