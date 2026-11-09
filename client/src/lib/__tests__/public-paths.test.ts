import { describe, expect, it } from 'vitest';
import {
  PUBLIC_DEEP_LINK_PREFIXES,
  PUBLIC_PATH_PREFIXES,
  PUBLIC_SECTIONS,
  buildLoginHref,
  buildRegisterHref,
  getSafeNextPath,
  isPublicPath,
} from '@/lib/public-paths';

describe('isPublicPath: the platform is private, the donation form is the one (main) page open to visitors', () => {
  it('has exactly one public section, /donations, and no public deep links', () => {
    expect(PUBLIC_SECTIONS).toEqual([{ href: '/donations', label: 'Donate' }]);
    expect(PUBLIC_DEEP_LINK_PREFIXES).toHaveLength(0);
    expect(PUBLIC_PATH_PREFIXES).toEqual(['/donations']);
  });

  it.each(['/donations', '/donations/', '/donations/thanks', '/donations/a/b', '/donations?amount=500', '/donations#form', '/donations/?x=1'])(
    'allows %s',
    (p) => expect(isPublicPath(p)).toBe(true)
  );

  it.each([
    '/events',
    '/events/abc',
    '/gallery',
    '/news',
    '/news/some-slug',
    '/donationsx',
    '/donations-archive',
    '/admin/donations',
    '/events/',
    '/chapters',
    '/chapters/c1',
    '/posts/p1',
    '/posts/123',
    '/search',
    '/search?q=x',
    '/directory',
    '/dashboard',
    '/eventsx',
    '/newsletter',
    '/',
    '',
    null,
    undefined,
    '/admin/events',
    '/postsx',
    '/videos',
    '/saved',
  ])('treats %s as not public', (p) => expect(isPublicPath(p as any)).toBe(false));

  it('ignores query strings', () => {
    expect(isPublicPath('/events?page=2')).toBe(false);
  });
});

describe('getSafeNextPath', () => {
  it('accepts relative app paths', () => {
    expect(getSafeNextPath('/events/1')).toBe('/events/1');
    expect(getSafeNextPath('/search?q=a%20b')).toBe('/search?q=a%20b');
  });

  it.each([
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    'javascript:alert(1)',
    'events',
    '',
    '/login',
    '/login?next=/x',
    '/register',
    '/a\nb',
  ])('rejects %s', (p) => expect(getSafeNextPath(p)).toBeNull());

  it('rejects non-strings', () => {
    expect(getSafeNextPath(null)).toBeNull();
    expect(getSafeNextPath(undefined)).toBeNull();
  });
});

describe('buildLoginHref', () => {
  it('encodes the return path', () => {
    expect(buildLoginHref('/events/1?tab=a')).toBe('/login?next=%2Fevents%2F1%3Ftab%3Da');
  });

  it('falls back to plain /login', () => {
    expect(buildLoginHref('//evil.com')).toBe('/login');
    expect(buildLoginHref('/')).toBe('/login');
    expect(buildLoginHref(undefined)).toBe('/login');
  });

  it('adds extra query params before the return path', () => {
    expect(buildLoginHref('/events/1', { registered: 'true' })).toBe('/login?registered=true&next=%2Fevents%2F1');
    expect(buildLoginHref('//evil.com', { registered: 'true' })).toBe('/login?registered=true');
  });
});

describe('buildRegisterHref', () => {
  it('carries a safe return path to /register', () => {
    expect(buildRegisterHref('/events/1?tab=a')).toBe('/register?next=%2Fevents%2F1%3Ftab%3Da');
  });

  it('falls back to plain /register', () => {
    expect(buildRegisterHref('https://evil.com')).toBe('/register');
    expect(buildRegisterHref('/login?next=/x')).toBe('/register');
    expect(buildRegisterHref('/')).toBe('/register');
    expect(buildRegisterHref(null)).toBe('/register');
  });
});
