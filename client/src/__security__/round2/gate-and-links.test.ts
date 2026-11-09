// @vitest-environment node
/**
 * ROUND 2 (client) - the members-only gate, the post-login redirect and the URL allowlists, attacked with path
 * spellings and encodings the round-1 tests did not cover.
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from '@/middleware';
import { getSafeNextPath, buildLoginHref } from '@/lib/public-paths';
import { safeHref, safeInternalPath, safeMediaSrc } from '@/lib/safe-url';

const matcherPattern = new RegExp(`^${config.matcher[0]}$`);
const req = (url: string, cookie?: string) => new NextRequest(`http://localhost:3005${url}`, cookie ? { headers: { cookie } } : undefined);

/** What actually happens to an anonymous request: skipped by the matcher, or sent through the middleware. */
const anonymousOutcome = (url: string): 'skipped' | 'served' | 'redirected' => {
  const pathname = new URL(url, 'http://localhost:3005').pathname;
  if (!matcherPattern.test(pathname)) return 'skipped';
  return middleware(req(url)).headers.get('location') ? 'redirected' : 'served';
};

describe('R2-22 the matcher does not exempt members-only PAGES just because their URL ends like a file', () => {
  // dynamic member routes: /profile/[id], /jobs/[id], /hashtags/[tag] accept ANY last segment
  it.each([
    '/profile/abc.png',
    '/profile/abc.css',
    '/profile/x.js',
    '/profile/x.json',
    '/profile/x.map',
    '/profile/john.doe.txt',
    '/jobs/42.xml',
    '/jobs/42.woff2',
    '/hashtags/react.svg',
    '/hashtags/x.webp',
    '/messages/x.ico',
    '/admin/users/x.png',
  ])('anonymous %s is redirected to login, not served the app shell', (url) => {
    expect(anonymousOutcome(url)).toBe('redirected');
  });

  it.each(['/favicon.ico', '/robots.txt', '/sitemap.xml', '/logo.png', '/icon.svg', '/manifest.webmanifest', '/_next/static/chunks/main.js', '/_next/image', '/api/users/me', '/api/search', '/.well-known/assetlinks.json', '/.well-known/security.txt'])(
    'static and infrastructure path %s is still skipped by the middleware',
    (url) => {
      expect(anonymousOutcome(url)).toBe('skipped');
    }
  );
});

describe('the gate is the same for every spelling of a members-only path', () => {
  it.each([
    '/dashboard',
    '/dashboard/',
    '/dashboard//',
    '//dashboard',
    '/DASHBOARD',
    '/Dashboard',
    '/dashboard/.',
    '/dashboard/../dashboard',
    '/events/../dashboard',
    '/events/%2e%2e/dashboard',
    '/events/%2E%2E/dashboard',
    '/events\\..\\dashboard',
    '/news/%2e%2e/%2e%2e/admin',
    '/search/../admin/users',
    '/posts/../directory',
    '/_nextfoo/x',
    '/_next',
    '/apiary',
    '/api',
    '/%61dmin',
    '/admin%2fusers',
    '/admin;x=1',
    '/admin%00',
    '/login/../dashboard',
    '/chapters/../messages',
  ])('anonymous %s never reaches an app page', (url) => {
    expect(['redirected', 'skipped']).toContain(anonymousOutcome(url));
  });

  it('the pages open to visitors are only the landing page, the auth screens, the legal pages and the guest donation page', () => {
    for (const url of ['/', '/login', '/register?next=%2Fjobs', '/verify-email?token=t', '/forgot-password', '/reset-password?token=t', '/privacy', '/terms', '/contact', '/cookies', '/donations', '/donations/', '/donations?amount=500']) {
      expect({ url, outcome: anonymousOutcome(url) }).toEqual({ url, outcome: 'served' });
    }
  });

  it('what used to be browsable without an account is behind the login now (only /donations is open)', () => {
    for (const url of ['/events', '/events/', '/events/42', '/news', '/news/some-slug', '/gallery', '/chapters', '/chapters/c1', '/posts/p1', '/search?q=ab']) {
      expect({ url, outcome: anonymousOutcome(url) }).toEqual({ url, outcome: 'redirected' });
    }
  });

  // The one open section must not become a way in to the rest: spellings that name a DIFFERENT page, or that only look
  // like /donations, are judged by the page they really name.
  it.each([
    '/donations/../dashboard',
    '/donations/%2e%2e/dashboard',
    '/donations/%2E%2E/admin/users',
    '/donations/../../admin',
    '/donations/./../directory',
    '/donations%2f..%2fdashboard',
    '/donations%2fx',
    '/DONATIONS',
    '/Donations',
    '/donationsx',
    '/donations-archive',
    '/donations;x=1',
    '/donations%00',
    '/admin/donations',
    '/profile/donations',
    '//donations',
  ])('anonymous %s is not served as the guest donation page', (url) => {
    // "//donations" and the upper-case spellings are different paths for the router (and the gate is fail-closed for them)
    expect(['redirected', 'skipped']).toContain(anonymousOutcome(url));
  });

  it('a forged hint cookie in the wrong shape does not open the gate', () => {
    for (const cookie of ['aitd_session=0', 'aitd_session=', 'xaitd_session=1', 'aitd_session=1x', 'aitd_session%3D1', 'a=aitd_session=1']) {
      expect({ cookie, location: middleware(req('/dashboard', cookie)).headers.get('location') !== null }).toEqual({ cookie, location: true });
    }
  });
});

describe('R2-23 ?next= can only ever name a page of this site', () => {
  const base = 'http://localhost:3005';
  const hostile = [
    '/.//evil.example/x',
    '/./\\evil.example',
    '/a/..//evil.example',
    '/%2e//evil.example',
    '/%2E%2E//evil.example',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\u0000/evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'evil.example',
    '',
    ' ',
    '/login',
    '/login?next=/dashboard',
    '/register',
  ];

  it.each(hostile)('rejects %j', (value) => {
    expect(getSafeNextPath(value)).toBeNull();
  });

  it('whatever it accepts resolves to a path on this origin that does not start with "//"', () => {
    for (const value of ['/dashboard', '/jobs/42?x=1#top', '/profile/john.doe', '/search?q=a%20b', '/posts/1#comment-2', '/events/42']) {
      const accepted = getSafeNextPath(value);
      expect(accepted).toBe(value);
      const url = new URL(accepted!, base);
      expect(url.origin).toBe(base);
      expect(url.pathname.startsWith('//')).toBe(false);
      // what history.pushState / router.push is handed after the router rebuilds the URL
      expect(new URL(url.pathname + url.search + url.hash, base).origin).toBe(base);
    }
  });

  it('login hrefs built from a hostile path degrade to plain /login', () => {
    for (const value of hostile) expect(buildLoginHref(value)).toBe('/login');
  });
});

describe('R2-24 safe-url: more variants', () => {
  it.each([
    'ｊａｖａｓｃｒｉｐｔ:alert(1)',
    'javascript&colon;alert(1)',
    'jaVa\u0000script:alert(1)',
    'java script:alert(1)',
    '­javascript:alert(1)',
    'ja­vascript:alert(1)',
    'javascript⁠:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'blob:https://evil.example/uuid',
    'file:///etc/passwd',
    'view-source:https://example.com',
    'about:blank',
    'https://user:pw@example.com',
    'https://@example.com@evil.example',
    'http:///',
    'https:',
    '//evil.example',
  ])('safeHref refuses %j', (value) => {
    expect(safeHref(value)).toBeUndefined();
    expect(safeHref(value, { allowRelative: true })).toBeUndefined();
  });

  it.each([
    '/uploads/%2e%2e/api/auth/me',
    '/uploads/%2E%2E/%2e%2e/etc',
    '/uploads/a%2f..%2f..%2fb.png',
    '/uploads/..%5csecret.png',
    '/uploads/a/%2e/b.png',
    '/uploads/../x.png',
    '/uploads/./x.png',
    '/UPLOADS/x.png',
    '//evil.example/uploads/x.png',
    'blob:https://evil.example/uuid',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'javascript:alert(1)',
  ])('safeMediaSrc refuses %j', (value) => {
    expect(safeMediaSrc(value)).toBeUndefined();
  });

  it('safeMediaSrc keeps working for what the API really produces', () => {
    for (const ok of ['/uploads/gallery/1700000000-abc.webp', 'https://lh3.googleusercontent.com/a/photo=s96-c', '/uploads/posts/a_b-c.png']) {
      expect(safeMediaSrc(ok)).toBe(ok);
    }
  });

  it.each(['/.//evil.example', '/a/..//evil.example', '/%2e//evil.example', '//evil.example', '/\\evil.example'])('safeInternalPath refuses %j', (value) => {
    expect(safeInternalPath(value)).toBeUndefined();
  });
});
