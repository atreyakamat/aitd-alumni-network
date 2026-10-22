import {
  ROLES,
  isAdminRole,
  hasMinRole,
  normalizeRole,
  canManageUser,
  canAssignRole,
  isOwnerOrAdmin,
} from '../../config/permissions';

describe('permissions policy', () => {
  describe('normalizeRole', () => {
    it.each([
      ['MEMBER', 'MEMBER'],
      ['admin', 'ADMIN'],
      ['super_admin', 'SUPER_ADMIN'],
      ['Chapter_Admin', 'CHAPTER_ADMIN'],
      [' ADMIN ', 'ADMIN'],
    ])('maps %p to %p', (input, expected) => {
      expect(normalizeRole(input)).toBe(expected);
    });

    it.each([undefined, null, '', 'ROOT', 'ALUMNI', 42])('falls back to MEMBER for %p', (input) => {
      expect(normalizeRole(input as any)).toBe('MEMBER');
    });
  });

  describe('isAdminRole', () => {
    it('is true only for ADMIN and SUPER_ADMIN', () => {
      expect(isAdminRole('ADMIN')).toBe(true);
      expect(isAdminRole('SUPER_ADMIN')).toBe(true);
      expect(isAdminRole('CHAPTER_ADMIN')).toBe(false);
      expect(isAdminRole('MEMBER')).toBe(false);
      expect(isAdminRole(undefined)).toBe(false);
    });
  });

  describe('hasMinRole', () => {
    it('respects the role hierarchy MEMBER < CHAPTER_ADMIN < ADMIN < SUPER_ADMIN', () => {
      expect(ROLES).toEqual(['MEMBER', 'CHAPTER_ADMIN', 'ADMIN', 'SUPER_ADMIN']);
      expect(hasMinRole('MEMBER', 'MEMBER')).toBe(true);
      expect(hasMinRole('MEMBER', 'CHAPTER_ADMIN')).toBe(false);
      expect(hasMinRole('CHAPTER_ADMIN', 'CHAPTER_ADMIN')).toBe(true);
      expect(hasMinRole('ADMIN', 'CHAPTER_ADMIN')).toBe(true);
      expect(hasMinRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
      expect(hasMinRole('SUPER_ADMIN', 'ADMIN')).toBe(true);
      expect(hasMinRole(undefined, 'MEMBER')).toBe(false);
    });
  });

  describe('canManageUser', () => {
    it('lets super admins manage anyone except themselves', () => {
      expect(canManageUser({ id: 'a', userRole: 'SUPER_ADMIN' }, { id: 'b', userRole: 'SUPER_ADMIN' })).toBe(true);
      expect(canManageUser({ id: 'a', userRole: 'SUPER_ADMIN' }, { id: 'a', userRole: 'SUPER_ADMIN' })).toBe(false);
    });

    it('lets admins manage only strictly lower roles', () => {
      expect(canManageUser({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'MEMBER' })).toBe(true);
      expect(canManageUser({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'CHAPTER_ADMIN' })).toBe(true);
      expect(canManageUser({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'ADMIN' })).toBe(false);
      expect(canManageUser({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'SUPER_ADMIN' })).toBe(false);
    });

    it('never lets members or chapter admins manage users', () => {
      expect(canManageUser({ id: 'a', userRole: 'MEMBER' }, { id: 'b', userRole: 'MEMBER' })).toBe(false);
      expect(canManageUser({ id: 'a', userRole: 'CHAPTER_ADMIN' }, { id: 'b', userRole: 'MEMBER' })).toBe(false);
    });
  });

  describe('canAssignRole', () => {
    it('lets super admins assign any role to others', () => {
      expect(canAssignRole({ id: 'a', userRole: 'SUPER_ADMIN' }, { id: 'b', userRole: 'MEMBER' }, 'SUPER_ADMIN')).toBe(true);
      expect(canAssignRole({ id: 'a', userRole: 'SUPER_ADMIN' }, { id: 'b', userRole: 'ADMIN' }, 'MEMBER')).toBe(true);
    });

    it('prevents anyone from changing their own role', () => {
      expect(canAssignRole({ id: 'a', userRole: 'SUPER_ADMIN' }, { id: 'a', userRole: 'SUPER_ADMIN' }, 'MEMBER')).toBe(false);
    });

    it('lets admins only grant roles below their own to users below them', () => {
      expect(canAssignRole({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'MEMBER' }, 'CHAPTER_ADMIN')).toBe(true);
      expect(canAssignRole({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'CHAPTER_ADMIN' }, 'MEMBER')).toBe(true);
      expect(canAssignRole({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'MEMBER' }, 'ADMIN')).toBe(false);
      expect(canAssignRole({ id: 'a', userRole: 'ADMIN' }, { id: 'b', userRole: 'ADMIN' }, 'MEMBER')).toBe(false);
    });

    it('rejects members and chapter admins', () => {
      expect(canAssignRole({ id: 'a', userRole: 'MEMBER' }, { id: 'b', userRole: 'MEMBER' }, 'MEMBER')).toBe(false);
      expect(canAssignRole({ id: 'a', userRole: 'CHAPTER_ADMIN' }, { id: 'b', userRole: 'MEMBER' }, 'MEMBER')).toBe(false);
    });
  });

  describe('isOwnerOrAdmin', () => {
    it('allows the owner', () => {
      expect(isOwnerOrAdmin({ id: 'u1', userRole: 'MEMBER' }, 'u1')).toBe(true);
    });
    it('allows admins on any resource', () => {
      expect(isOwnerOrAdmin({ id: 'u2', userRole: 'ADMIN' }, 'u1')).toBe(true);
    });
    it('denies other members and chapter admins', () => {
      expect(isOwnerOrAdmin({ id: 'u2', userRole: 'MEMBER' }, 'u1')).toBe(false);
      expect(isOwnerOrAdmin({ id: 'u2', userRole: 'CHAPTER_ADMIN' }, 'u1')).toBe(false);
    });
    it('denies when there is no user', () => {
      expect(isOwnerOrAdmin(undefined, 'u1')).toBe(false);
    });
  });
});
