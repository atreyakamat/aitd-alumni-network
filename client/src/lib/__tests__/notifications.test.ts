import { describe, expect, it } from 'vitest';
import {
  formatBadgeCount,
  formatNotificationTime,
  getNotificationHref,
  mapLegacyNotificationPath,
} from '@/lib/notifications';

const origin = 'https://aitd.example.com';

describe('getNotificationHref', () => {
  it('returns internal paths as-is', () => {
    expect(getNotificationHref({ link: '/events/1' }, origin)).toBe('/events/1');
  });

  it('falls back to the legacy linkUrl field', () => {
    expect(getNotificationHref({ link: null, linkUrl: '/jobs/2' }, origin)).toBe('/jobs/2');
  });

  it('reduces same-origin absolute URLs to a path', () => {
    expect(getNotificationHref({ link: `${origin}/register?ref=abc` }, origin)).toBe('/register?ref=abc');
  });

  it.each([null, '', '   ', '//evil.com/x', '/\\evil.com', 'https://evil.com/x', 'javascript:alert(1)', 'events/1'])(
    'rejects %s',
    (link) => expect(getNotificationHref({ link: link as any }, origin)).toBeNull()
  );
});

describe('formatNotificationTime', () => {
  it('formats relative time', () => {
    expect(formatNotificationTime(new Date(Date.now() - 2 * 60 * 60_000).toISOString())).toBe('about 2 hours ago');
  });

  it('handles bad input', () => {
    expect(formatNotificationTime(undefined)).toBe('');
    expect(formatNotificationTime('not a date')).toBe('');
  });
});

describe('formatBadgeCount', () => {
  it('hides zero and caps at 99+', () => {
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(undefined)).toBeNull();
    expect(formatBadgeCount(7)).toBe('7');
    expect(formatBadgeCount(100)).toBe('99+');
  });
});

describe('legacy notification links', () => {
  it.each([
    ['/posts/abc', '/posts/abc'],
    ['/posts/abc#comment-c1', '/posts/abc#comment-c1'],
    ['/posts', '/dashboard'],
    ['/mentorship/requests', '/mentorship'],
    ['/network/requests', '/network'],
    ['/messages/user-1', '/messages?u=user-1'],
    ['/messages/a%20b', '/messages?u=a%20b'],
    ['/messages?u=user-1', '/messages?u=user-1'],
    ['/events/9', '/events/9'],
    ['/mentorship', '/mentorship'],
  ])('maps %s -> %s', (link, expected) => {
    expect(getNotificationHref({ link }, origin)).toBe(expected);
    expect(mapLegacyNotificationPath(link)).toBe(expected);
  });

  it('maps legacy paths inside same-origin absolute URLs', () => {
    expect(getNotificationHref({ link: `${origin}/posts` }, origin)).toBe('/dashboard');
    expect(getNotificationHref({ link: `${origin}/posts/1` }, origin)).toBe('/posts/1');
  });
});
