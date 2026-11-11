import { afterEach, describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_HINT_MAX_AGE_SECONDS,
  buildClearSessionHintCookie,
  buildSessionHintCookie,
  clearSessionHint,
  hasSessionHint,
  setSessionHint,
} from '@/lib/session-hint';

afterEach(() => clearSessionHint());

describe('session hint cookie builders', () => {
  it('is aiem_session=1, path /, SameSite=Lax, 7 days', () => {
    expect(SESSION_COOKIE).toBe('aiem_session');
    expect(SESSION_HINT_MAX_AGE_SECONDS).toBe(604800);
    const c = buildSessionHintCookie(false);
    expect(c).toContain('aiem_session=1');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=604800');
    expect(c).toContain('SameSite=Lax');
    expect(c).not.toContain('Secure');
  });

  it('adds Secure over https', () => {
    expect(buildSessionHintCookie(true)).toContain('; Secure');
    expect(buildClearSessionHintCookie(true)).toContain('; Secure');
  });

  it('clear cookie expires immediately on the same path', () => {
    const c = buildClearSessionHintCookie(false);
    expect(c).toContain('aiem_session=;');
    expect(c).toContain('Max-Age=0');
    expect(c).toContain('Path=/');
  });
});

describe('hasSessionHint', () => {
  it('detects the cookie among others', () => {
    expect(hasSessionHint('a=b; aiem_session=1; c=d')).toBe(true);
    expect(hasSessionHint('aiem_session=1')).toBe(true);
  });
  it.each([null, undefined, '', 'aiem_session=0', 'aiem_session=', 'x_aiem_session=1', 'aiem_session=10', 'a=b'])('is false for %j', (h) =>
    expect(hasSessionHint(h as string | null | undefined)).toBe(false)
  );
});

describe('set/clear in the browser', () => {
  it('writes and removes document.cookie', () => {
    expect(hasSessionHint(document.cookie)).toBe(false);
    setSessionHint();
    expect(hasSessionHint(document.cookie)).toBe(true);
    clearSessionHint();
    expect(hasSessionHint(document.cookie)).toBe(false);
  });
});
