import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { normalizeUser } from '@/context/auth-context';

const base = { id: 'u1', email: 'a@b.c', fullName: 'Ada Lovelace' };

describe('normalizeUser', () => {
  it('maps the server userRole field (any case) to a canonical role', () => {
    expect(normalizeUser({ ...base, userRole: 'admin' }).role).toBe('ADMIN');
    expect(normalizeUser({ ...base, userRole: 'SUPER_ADMIN' }).role).toBe('SUPER_ADMIN');
    expect(normalizeUser({ ...base, userRole: 'chapter_admin' }).role).toBe('CHAPTER_ADMIN');
  });

  it('supports a legacy role field and legacy spellings', () => {
    expect(normalizeUser({ ...base, role: 'SUPERADMIN' }).role).toBe('SUPER_ADMIN');
  });

  it('prefers userRole over role when both exist', () => {
    expect(normalizeUser({ ...base, role: 'MEMBER', userRole: 'ADMIN' }).role).toBe('ADMIN');
  });

  it('defaults unknown or missing roles to MEMBER', () => {
    expect(normalizeUser({ ...base }).role).toBe('MEMBER');
    expect(normalizeUser({ ...base, userRole: 'ALUMNI' }).role).toBe('MEMBER');
  });

  it('keeps userRole in sync with role', () => {
    const user = normalizeUser({ ...base, userRole: 'admin' });
    expect(user.userRole).toBe(user.role);
  });

  it('maps profile photo, membership tier and defaults', () => {
    const user = normalizeUser({
      ...base,
      profilePhotoUrl: 'https://x/y.png',
      membershipTier: { name: 'Gold' },
      isVerified: 1,
    });
    expect(user.avatarUrl).toBe('https://x/y.png');
    expect(user.membershipTier).toBe('Gold');
    expect(user.isVerified).toBe(true);
    expect(user.department).toBe('Unknown');
    expect(user.profileCompleteness).toBe(0);
  });

  it('passes through roleType (ALUMNI/STUDENT) without affecting role', () => {
    const user = normalizeUser({ ...base, roleType: 'STUDENT', userRole: 'MEMBER' });
    expect(user.roleType).toBe('STUDENT');
    expect(user.role).toBe('MEMBER');
  });
});
