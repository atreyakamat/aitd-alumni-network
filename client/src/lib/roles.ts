/**
 * Role normalization and hierarchy helpers (PRD §9.1).
 *
 * All auth-derived UI gating must go through these helpers instead of
 * comparing raw role strings. They mirror the server hierarchy
 * (MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN). Client-side checks are UX
 * only; the server remains the source of truth for enforcement.
 */

export const ROLES = ['MEMBER', 'CHAPTER_ADMIN', 'ADMIN', 'SUPER_ADMIN'] as const;

export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = {
  MEMBER: 0,
  CHAPTER_ADMIN: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

const ROLE_LABELS: Record<Role, string> = {
  MEMBER: 'Member',
  CHAPTER_ADMIN: 'Chapter Admin',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super Admin',
};

/** Roles an ADMIN (not SUPER_ADMIN) may hand out. */
const ADMIN_ASSIGNABLE: readonly Role[] = ['MEMBER', 'CHAPTER_ADMIN'];

/** Anything that carries a role: a raw string or a user-like object. */
export type RoleSource =
  | string
  | { role?: unknown; userRole?: unknown }
  | null
  | undefined;

const canonicalize = (value: unknown): Role | null => {
  if (typeof value !== 'string') return null;
  const key = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!key) return null;
  if ((ROLES as readonly string[]).includes(key)) return key as Role;
  // Legacy / alternate spellings seen in older tokens and seed data.
  if (key === 'SUPERADMIN') return 'SUPER_ADMIN';
  if (key === 'CHAPTERADMIN') return 'CHAPTER_ADMIN';
  return null;
};

/**
 * Map any role-ish value to a canonical Role. Accepts raw strings in any case
 * or user objects exposing `userRole` (server field) and/or `role` (legacy
 * client field). Unknown values fall back to the least-privileged MEMBER.
 */
export function normalizeRole(source: unknown): Role {
  if (source && typeof source === 'object') {
    const obj = source as { role?: unknown; userRole?: unknown };
    return canonicalize(obj.userRole) ?? canonicalize(obj.role) ?? 'MEMBER';
  }
  return canonicalize(source) ?? 'MEMBER';
}

export const roleRank = (source: unknown): number => ROLE_RANK[normalizeRole(source)];

export function hasMinRole(source: unknown, minimum: Role): boolean {
  if (source === null || source === undefined) {
    return minimum === 'MEMBER';
  }
  return roleRank(source) >= ROLE_RANK[minimum];
}

export const isAdmin = (source: unknown): boolean => hasMinRole(source, 'ADMIN');
export const isSuperAdmin = (source: unknown): boolean => hasMinRole(source, 'SUPER_ADMIN');
export const isChapterAdminOrAbove = (source: unknown): boolean =>
  hasMinRole(source, 'CHAPTER_ADMIN');

export const roleLabel = (source: unknown): string => ROLE_LABELS[normalizeRole(source)];

interface SelfOption {
  /** True when the actor and target are the same account. */
  isSelf?: boolean;
}

/**
 * Whether `actorRole` may change status/role of a user with `targetRole`.
 * SUPER_ADMIN may manage anyone but themselves; ADMIN only users ranked below.
 */
export function canManageUser(actorRole: unknown, targetRole: unknown, opts: SelfOption = {}): boolean {
  if (opts.isSelf) return false;
  const actor = normalizeRole(actorRole);
  if (actor === 'SUPER_ADMIN') return true;
  if (actor !== 'ADMIN') return false;
  return ROLE_RANK[normalizeRole(targetRole)] < ROLE_RANK[actor];
}

/**
 * Whether `actorRole` may set `newRole` on a user currently holding
 * `targetRole`. Mirrors the server rules:
 * - nobody changes their own role
 * - SUPER_ADMIN may assign any role to anyone else
 * - ADMIN may assign MEMBER / CHAPTER_ADMIN to users ranked below them
 * - everyone else may not assign roles
 */
export function canAssignRole(
  actorRole: unknown,
  targetRole: unknown,
  newRole: unknown,
  opts: SelfOption = {}
): boolean {
  if (!canManageUser(actorRole, targetRole, opts)) return false;
  const actor = normalizeRole(actorRole);
  if (actor === 'SUPER_ADMIN') return true;
  return ADMIN_ASSIGNABLE.includes(normalizeRole(newRole));
}

/** The roles `actorRole` may pick for a target, in hierarchy order. */
export function assignableRoles(actorRole: unknown, targetRole: unknown, opts: SelfOption = {}): Role[] {
  return ROLES.filter((role) => canAssignRole(actorRole, targetRole, role, opts));
}
