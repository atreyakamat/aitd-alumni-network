// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { config, middleware } from '@/middleware';

const req = (url: string, cookie?: string) =>
  new NextRequest(`http://localhost:3005${url}`, cookie ? { headers: { cookie } } : undefined);

describe('middleware', () => {
  it('redirects anonymous requests for member pages with a 307 to /login?next=', () => {
    const res = middleware(req('/dashboard'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/dashboard');
    expect(location.host).toBe('localhost:3005');
  });

  it('preserves the query in next', () => {
    const res = middleware(req('/directory?batch=2020'));
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/directory?batch=2020');
  });

  it('serves member pages when the hint cookie is present', () => {
    const res = middleware(req('/dashboard', 'foo=bar; aitd_session=1'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('serves public and auth pages anonymously', () => {
    for (const p of ['/', '/login', '/events', '/events/1', '/news', '/privacy']) {
      expect(middleware(req(p)).headers.get('location'), p).toBeNull();
    }
  });

  it('matcher skips assets and the API proxy but not pages with dots', () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ['/_next/static/chunk.js', '/api/auth/me', '/favicon.ico', '/logo.png']) expect(pattern.test(p), p).toBe(false);
    for (const p of ['/dashboard', '/admin/users', '/profile/john.doe', '/hashtags/js']) expect(pattern.test(p), p).toBe(true);
  });
});
