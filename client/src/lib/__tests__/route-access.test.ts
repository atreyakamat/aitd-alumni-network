import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { decideAccess } from '@/lib/route-access';
import { OPEN_PATH_PREFIXES, PUBLIC_PATH_PREFIXES, isMemberOnlyPath, isPublicPath } from '@/lib/public-paths';

const gate = (pathname: string, search = '', hasSessionHint = false) => decideAccess({ pathname, search, hasSessionHint });

describe('decideAccess (middleware decision)', () => {
  it.each([
    '/dashboard', '/directory', '/jobs', '/jobs/42', '/yearbook', '/admin', '/admin/users', '/messages', '/profile/abc', '/videos', '/saved',
    // the platform is private: these used to be open to visitors
    '/events', '/events/42', '/gallery', '/news', '/news/some-slug', '/donations', '/chapters', '/chapters/c1', '/posts/123', '/search',
  ])(
    'redirects anonymous visitors from %s to login with next',
    (p) => {
      expect(gate(p)).toEqual({ action: 'redirect', location: `/login?next=${encodeURIComponent(p)}` });
    }
  );

  it('keeps the query string in next and encodes it', () => {
    expect(gate('/directory', '?batch=2020&q=a b')).toEqual({
      action: 'redirect',
      location: `/login?next=${encodeURIComponent('/directory?batch=2020&q=a b')}`,
    });
  });

  // THE allow-list of the private platform: the landing page, the auth screens and the legal/contact pages. Adding a path
  // here means opening it to the whole internet: do it on purpose.
  const ALLOWED_TO_VISITORS = ['/', '/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/privacy', '/terms', '/contact', '/cookies'];

  it.each(ALLOWED_TO_VISITORS)('lets anonymous visitors through to %s', (p) => expect(gate(p)).toEqual({ action: 'next' }));

  it('opens nothing else: the open prefixes are exactly the allow-list (plus the landing page)', () => {
    expect(['/', ...OPEN_PATH_PREFIXES].sort()).toEqual([...ALLOWED_TO_VISITORS].sort());
    expect(PUBLIC_PATH_PREFIXES).toEqual([]);
  });

  it('sends a visitor who opens a shared deep link to the login page, remembering where they wanted to go', () => {
    expect(gate('/posts/123')).toEqual({ action: 'redirect', location: '/login?next=%2Fposts%2F123' });
    expect(gate('/search', '?q=x')).toEqual({ action: 'redirect', location: '/login?next=%2Fsearch%3Fq%3Dx' });
    expect(gate('/events')).toEqual({ action: 'redirect', location: '/login?next=%2Fevents' });
    expect(gate('/events/42', '?tab=rsvp')).toEqual({ action: 'redirect', location: '/login?next=%2Fevents%2F42%3Ftab%3Drsvp' });
  });

  it('lets everything through when the session hint is present', () => {
    for (const p of ['/dashboard', '/admin/users', '/jobs/1']) expect(gate(p, '', true)).toEqual({ action: 'next' });
  });

  it('does not loop on /login and never builds an unsafe next', () => {
    expect(gate('/login', '?next=/dashboard')).toEqual({ action: 'next' });
    // a path that getSafeNextPath rejects degrades to a plain /login
    expect(gate('//evil.com/x')).toEqual({ action: 'redirect', location: '/login' });
  });

  it('is fail-closed for unknown paths and look-alike prefixes', () => {
    expect(isMemberOnlyPath('/some-new-page')).toBe(true);
    expect(isMemberOnlyPath('/eventsx')).toBe(true);
    expect(isMemberOnlyPath('/loginx')).toBe(true);
    expect(isMemberOnlyPath('/hashtags/js')).toBe(true);
    expect(isMemberOnlyPath('/profile/john.doe')).toBe(true);
  });

  it('treats trailing slashes and query strings like the bare path', () => {
    expect(isMemberOnlyPath('/directory/')).toBe(true);
    expect(isMemberOnlyPath('/events/?page=2')).toBe(true);
    expect(isMemberOnlyPath('/login/')).toBe(false);
  });
});

/**
 * Drift guard: every route folder under src/app must be classified consistently with the middleware
 * (so adding a page to (main) cannot accidentally leave it open, nor an auth page get gated).
 */
describe('route classification matches the app directory', () => {
  const appDir = path.resolve(__dirname, '../../app');
  const topLevelSegments = (group: string) =>
    fs
      .readdirSync(path.join(appDir, group), { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== '__tests__' && !d.name.startsWith('['))
      .map((d) => `/${d.name}`);

  it('every (main) route is member-only: the platform is private', () => {
    const segments = topLevelSegments('(main)');
    expect(segments).toContain('/dashboard');
    expect(segments).toContain('/admin');
    expect(segments).toContain('/events');
    expect(segments).toContain('/posts');
    expect(segments).toContain('/search');
    for (const seg of segments) {
      expect(isMemberOnlyPath(seg), seg).toBe(true);
      expect(isPublicPath(seg), seg).toBe(false);
    }
  });

  it('the app has no page outside (main) that is not on the allow-list', () => {
    const topLevelPages = fs
      .readdirSync(appDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('(') && !d.name.startsWith('_') && d.name !== 'api')
      .map((d) => `/${d.name}`);
    expect(topLevelPages).toEqual([]);
  });

  it.each(['(auth)', '(legal)'])('every %s route stays open', (group) => {
    for (const seg of topLevelSegments(group)) {
      expect(isMemberOnlyPath(seg), seg).toBe(false);
      expect(OPEN_PATH_PREFIXES, seg).toContain(seg);
    }
  });

  it('OPEN_PATH_PREFIXES lists no (main) route', () => {
    const main = topLevelSegments('(main)');
    for (const prefix of OPEN_PATH_PREFIXES) expect(main, prefix).not.toContain(prefix);
  });
});
