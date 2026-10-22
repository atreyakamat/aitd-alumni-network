import { describe, expect, it } from 'vitest';
import {
  ROLES,
  assignableRoles,
  canAssignRole,
  canManageUser,
  hasMinRole,
  isAdmin,
  isChapterAdminOrAbove,
  isSuperAdmin,
  normalizeRole,
  roleLabel,
} from '@/lib/roles';

describe('normalizeRole', () => {
  it('returns canonical roles unchanged', () => {
    for (const role of ROLES) {
      expect(normalizeRole(role)).toBe(role);
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeRole('admin')).toBe('ADMIN');
    expect(normalizeRole('  Super_Admin ')).toBe('SUPER_ADMIN');
    expect(normalizeRole('chapter_admin')).toBe('CHAPTER_ADMIN');
  });

  it('accepts legacy / alternative spellings', () => {
    expect(normalizeRole('SUPERADMIN')).toBe('SUPER_ADMIN');
    expect(normalizeRole('super-admin')).toBe('SUPER_ADMIN');
    expect(normalizeRole('super admin')).toBe('SUPER_ADMIN');
    expect(normalizeRole('ChapterAdmin')).toBe('CHAPTER_ADMIN');
    expect(normalizeRole('chapter-admin')).toBe('CHAPTER_ADMIN');
  });

  it('falls back to MEMBER for unknown, empty or non-string values', () => {
    expect(normalizeRole('ALUMNI')).toBe('MEMBER');
    expect(normalizeRole('owner')).toBe('MEMBER');
    expect(normalizeRole('')).toBe('MEMBER');
    expect(normalizeRole(undefined)).toBe('MEMBER');
    expect(normalizeRole(null)).toBe('MEMBER');
    expect(normalizeRole(42)).toBe('MEMBER');
    expect(normalizeRole({})).toBe('MEMBER');
  });

  it('reads role or userRole from a user-like object, preferring userRole', () => {
    expect(normalizeRole({ userRole: 'admin' })).toBe('ADMIN');
    expect(normalizeRole({ role: 'super_admin' })).toBe('SUPER_ADMIN');
    expect(normalizeRole({ role: 'MEMBER', userRole: 'CHAPTER_ADMIN' })).toBe('CHAPTER_ADMIN');
    expect(normalizeRole({ role: 'ADMIN', userRole: 'bogus' })).toBe('ADMIN');
  });
});

describe('hasMinRole', () => {
  it('follows MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN', () => {
    expect(hasMinRole('MEMBER', 'MEMBER')).toBe(true);
    expect(hasMinRole('MEMBER', 'CHAPTER_ADMIN')).toBe(false);
    expect(hasMinRole('CHAPTER_ADMIN', 'CHAPTER_ADMIN')).toBe(true);
    expect(hasMinRole('CHAPTER_ADMIN', 'ADMIN')).toBe(false);
    expect(hasMinRole('ADMIN', 'CHAPTER_ADMIN')).toBe(true);
    expect(hasMinRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(hasMinRole('SUPER_ADMIN', 'ADMIN')).toBe(true);
  });

  it('normalizes raw values and user objects', () => {
    expect(hasMinRole('superadmin', 'ADMIN')).toBe(true);
    expect(hasMinRole({ userRole: 'admin' }, 'ADMIN')).toBe(true);
    expect(hasMinRole(undefined, 'MEMBER')).toBe(true);
    expect(hasMinRole(undefined, 'ADMIN')).toBe(false);
    expect(hasMinRole(null, 'CHAPTER_ADMIN')).toBe(false);
  });
});

describe('role predicates', () => {
  it('isAdmin is true for ADMIN and SUPER_ADMIN only', () => {
    expect(isAdmin('MEMBER')).toBe(false);
    expect(isAdmin('CHAPTER_ADMIN')).toBe(false);
    expect(isAdmin('ADMIN')).toBe(true);
    expect(isAdmin('SUPERADMIN')).toBe(true);
    expect(isAdmin(null)).toBe(false);
  });

  it('isSuperAdmin is true for SUPER_ADMIN only', () => {
    expect(isSuperAdmin('ADMIN')).toBe(false);
    expect(isSuperAdmin('super_admin')).toBe(true);
    expect(isSuperAdmin({ role: 'SUPER_ADMIN' })).toBe(true);
  });

  it('isChapterAdminOrAbove covers chapter admins and admins', () => {
    expect(isChapterAdminOrAbove('MEMBER')).toBe(false);
    expect(isChapterAdminOrAbove('chapter_admin')).toBe(true);
    expect(isChapterAdminOrAbove('ADMIN')).toBe(true);
    expect(isChapterAdminOrAbove('SUPER_ADMIN')).toBe(true);
  });
});

describe('canAssignRole', () => {
  it('denies non-admin actors entirely', () => {
    for (const newRole of ROLES) {
      expect(canAssignRole('MEMBER', 'MEMBER', newRole)).toBe(false);
      expect(canAssignRole('CHAPTER_ADMIN', 'MEMBER', newRole)).toBe(false);
    }
  });

  it('lets ADMIN assign MEMBER/CHAPTER_ADMIN to users below them', () => {
    expect(canAssignRole('ADMIN', 'MEMBER', 'CHAPTER_ADMIN')).toBe(true);
    expect(canAssignRole('ADMIN', 'CHAPTER_ADMIN', 'MEMBER')).toBe(true);
    expect(canAssignRole('ADMIN', 'MEMBER', 'MEMBER')).toBe(true);
  });

  it('does not let ADMIN grant ADMIN or SUPER_ADMIN', () => {
    expect(canAssignRole('ADMIN', 'MEMBER', 'ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'CHAPTER_ADMIN', 'SUPER_ADMIN')).toBe(false);
  });

  it('does not let ADMIN modify peers or superiors', () => {
    expect(canAssignRole('ADMIN', 'ADMIN', 'MEMBER')).toBe(false);
    expect(canAssignRole('ADMIN', 'SUPER_ADMIN', 'MEMBER')).toBe(false);
  });

  it('lets SUPER_ADMIN assign anything to anyone else', () => {
    for (const target of ROLES) {
      for (const newRole of ROLES) {
        expect(canAssignRole('SUPER_ADMIN', target, newRole)).toBe(true);
      }
    }
  });

  it('never allows changing your own role', () => {
    expect(canAssignRole('SUPER_ADMIN', 'SUPER_ADMIN', 'ADMIN', { isSelf: true })).toBe(false);
    expect(canAssignRole('ADMIN', 'ADMIN', 'MEMBER', { isSelf: true })).toBe(false);
  });

  it('normalizes raw role strings', () => {
    expect(canAssignRole('admin', 'member', 'chapter_admin')).toBe(true);
    expect(canAssignRole('superadmin', 'admin', 'member')).toBe(true);
  });
});

describe('canManageUser / assignableRoles', () => {
  it('canManageUser requires ADMIN+ and a strictly higher rank (SUPER_ADMIN manages all others)', () => {
    expect(canManageUser('ADMIN', 'MEMBER')).toBe(true);
    expect(canManageUser('ADMIN', 'CHAPTER_ADMIN')).toBe(true);
    expect(canManageUser('ADMIN', 'ADMIN')).toBe(false);
    expect(canManageUser('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
    expect(canManageUser('SUPER_ADMIN', 'SUPER_ADMIN', { isSelf: true })).toBe(false);
    expect(canManageUser('CHAPTER_ADMIN', 'MEMBER')).toBe(false);
  });

  it('assignableRoles lists the allowed options in hierarchy order', () => {
    expect(assignableRoles('ADMIN', 'MEMBER')).toEqual(['MEMBER', 'CHAPTER_ADMIN']);
    expect(assignableRoles('ADMIN', 'ADMIN')).toEqual([]);
    expect(assignableRoles('SUPER_ADMIN', 'MEMBER')).toEqual([...ROLES]);
    expect(assignableRoles('SUPER_ADMIN', 'ADMIN', { isSelf: true })).toEqual([]);
    expect(assignableRoles('MEMBER', 'MEMBER')).toEqual([]);
  });
});

describe('roleLabel', () => {
  it('produces human-friendly labels', () => {
    expect(roleLabel('SUPER_ADMIN')).toBe('Super Admin');
    expect(roleLabel('chapter_admin')).toBe('Chapter Admin');
    expect(roleLabel('member')).toBe('Member');
  });
});
