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
    const res = middleware(req('/dashboard', 'foo=bar; aiem_session=1'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('serves only the landing page, the auth screens, the legal pages and the guest donation page anonymously', () => {
    for (const p of ['/', '/login', '/register', '/verify-email', '/forgot-password', '/reset-password', '/privacy', '/terms', '/contact', '/cookies', '/donations', '/donations/', '/donations/anything']) {
      expect(middleware(req(p)).headers.get('location'), p).toBeNull();
    }
  });

  it('a visitor on /donations keeps the query string and is not redirected', () => {
    const res = middleware(req('/donations?amount=500'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('the platform is private: events, news, gallery, chapters, posts and search all go to login (only /donations is open)', () => {
    for (const p of ['/events', '/events/1', '/news', '/news/some-slug', '/gallery', '/chapters', '/posts/123', '/search', '/profile/abc', '/donationsx', '/admin/donations']) {
      const res = middleware(req(p));
      expect(res.status, p).toBe(307);
      const location = new URL(res.headers.get('location')!);
      expect(location.pathname, p).toBe('/login');
      expect(location.searchParams.get('next'), p).toBe(p);
    }
  });

  it('a shared deep link keeps its query string for after sign-in', () => {
    const res = middleware(req('/search?q=x'));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/search?q=x');
  });

  it('matcher skips assets and the API proxy but not pages with dots', () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ['/_next/static/chunk.js', '/api/auth/me', '/favicon.ico', '/logo.png']) expect(pattern.test(p), p).toBe(false);
    for (const p of ['/dashboard', '/admin/users', '/profile/john.doe', '/hashtags/js']) expect(pattern.test(p), p).toBe(true);
  });
});
