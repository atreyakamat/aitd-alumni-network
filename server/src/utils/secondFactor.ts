import { config } from '../config';
import { hasMinRole } from '../config/permissions';

/**
 * Does signing in as this account need the e-mailed second factor? Yes when the member turned 2FA on, and for every
 * administrator while REQUIRE_ADMIN_2FA is on (the production default).
 */
export const secondFactorRequired = (user: { twoFactorEnabled?: boolean | null; userRole?: unknown }): boolean =>
  Boolean(user.twoFactorEnabled) || (config.auth.requireAdmin2FA && hasMinRole(user.userRole, 'CHAPTER_ADMIN'));
