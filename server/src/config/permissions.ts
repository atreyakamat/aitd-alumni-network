import { UserRole } from '@prisma/client';

/**
 * Canonical role-based access policy.
 *
 * Every role check in the API goes through this module so that the hierarchy
 * (MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN) is defined exactly once.
 */

export const ROLES: UserRole[] = ['MEMBER', 'CHAPTER_ADMIN', 'ADMIN', 'SUPER_ADMIN'];

const ROLE_RANK: Record<UserRole, number> = {
  MEMBER: 0,
  CHAPTER_ADMIN: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export interface Actor {
  id: string;
  userRole?: UserRole | string | null;
}

export const normalizeRole = (role: unknown): UserRole => {
  if (typeof role !== 'string') return 'MEMBER';
  const upper = role.trim().toUpperCase() as UserRole;
  return upper in ROLE_RANK ? upper : 'MEMBER';
};

const rankOf = (role: unknown): number => {
  if (typeof role !== 'string' || !(role in ROLE_RANK)) return -1;
  return ROLE_RANK[role as UserRole];
};

export const hasMinRole = (role: unknown, minimum: UserRole): boolean =>
  rankOf(role) >= ROLE_RANK[minimum];

export const isAdminRole = (role: unknown): boolean => hasMinRole(role, 'ADMIN');

export const isOwnerOrAdmin = (actor: Actor | undefined | null, ownerId: string | null | undefined): boolean => {
  if (!actor) return false;
  return (!!ownerId && actor.id === ownerId) || isAdminRole(actor.userRole);
};

/** Can `actor` moderate (activate/deactivate) `target`? */
export const canManageUser = (actor: Actor, target: Actor): boolean => {
  if (actor.id === target.id) return false;
  if (actor.userRole === 'SUPER_ADMIN') return true;
  return isAdminRole(actor.userRole) && rankOf(target.userRole) < rankOf(actor.userRole);
};

/** Can `actor` change `target`'s role to `newRole`? */
export const canAssignRole = (actor: Actor, target: Actor, newRole: UserRole): boolean => {
  if (!canManageUser(actor, target)) return false;
  if (actor.userRole === 'SUPER_ADMIN') return true;
  return rankOf(newRole) < rankOf(actor.userRole);
};
