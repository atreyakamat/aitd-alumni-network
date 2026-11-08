import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { decideAccess } from '@/lib/route-access';
import { OPEN_PATH_PREFIXES, PUBLIC_PATH_PREFIXES, isMemberOnlyPath, isPublicPath } from '@/lib/public-paths';

const gate = (pathname: string, search = '', hasSessionHint = false) => decideAccess({ pathname, search, hasSessionHint });

describe('decideAccess (middleware decision)', () => {
  it.each(['/dashboard', '/directory', '/jobs', '/jobs/42', '/yearbook', '/admin', '/admin/users', '/messages', '/profile/abc', '/reels', '/saved'])(
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

  it.each([...PUBLIC_PATH_PREFIXES, '/events/42', '/news/some-slug', '/posts/p1', '/search', '/', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/privacy', '/terms', '/contact', '/cookies'])(
    'lets anonymous visitors through to %s',
    (p) => expect(gate(p)).toEqual({ action: 'next' })
  );

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
    expect(isMemberOnlyPath('/events/?page=2')).toBe(false);
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

  it('every (main) route is member-only unless it is a public section', () => {
    const segments = topLevelSegments('(main)');
    expect(segments).toContain('/dashboard');
    expect(segments).toContain('/admin');
    for (const seg of segments) {
      const expectedPublic = PUBLIC_PATH_PREFIXES.includes(seg);
      expect(isMemberOnlyPath(seg), seg).toBe(!expectedPublic);
      expect(isPublicPath(seg), seg).toBe(expectedPublic);
    }
  });

  it('(main) routes that are public per PUBLIC_PATH_PREFIXES really exist', () => {
    const segments = topLevelSegments('(main)');
    for (const prefix of PUBLIC_PATH_PREFIXES) expect(segments, prefix).toContain(prefix);
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
