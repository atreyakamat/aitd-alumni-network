import { describe, expect, it } from 'vitest';
import { buildLoginHref, buildRegisterHref, getSafeNextPath, isPublicPath } from '@/lib/public-paths';

describe('isPublicPath', () => {
  it.each(['/events', '/events/abc', '/gallery', '/news', '/news/some-slug', '/donations', '/events/', '/chapters', '/chapters/c1', '/posts/p1'])(
    'allows %s',
    (p) => expect(isPublicPath(p)).toBe(true)
  );

  it.each(['/directory', '/dashboard', '/eventsx', '/newsletter', '/', '', null, undefined, '/admin/events', '/postsx', '/reels', '/saved'])(
    'rejects %s',
    (p) => expect(isPublicPath(p as any)).toBe(false)
  );

  it('ignores query strings', () => {
    expect(isPublicPath('/events?page=2')).toBe(true);
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
