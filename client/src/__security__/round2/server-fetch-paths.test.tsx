/**
 * ROUND 2 (client) - server-side fetches that put a route parameter into an API URL must encode it. Next decodes
 * dynamic segments (/profile/..%2F..%2Fadmin%2Fusers arrives as "../../admin/users"), so an unencoded template turns a
 * profile id into an arbitrary path (and query string) on the API origin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../app/(main)/profile/[id]/ProfileClient', () => ({ ProfileClient: () => null }));

import { generateMetadata as profileMetadata } from '../../app/(main)/profile/[id]/page';
import { generateMetadata as eventMetadata } from '../../app/(main)/events/[id]/layout';

const HOSTILE_IDS = ['../users/notable', '../../admin/export/users', 'x?role=ADMIN', 'x#frag', 'a/b', '%2e%2e/%2e%2e/health', 'x\\..\\y'];

describe('R2-25 route params are encoded before they reach the API URL', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        return { ok: true, json: async () => ({ data: null }) } as Response;
      })
    );
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.test/api';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(HOSTILE_IDS)('profile page: %j stays one path segment', async (id) => {
    await profileMetadata({ params: Promise.resolve({ id }) });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.origin).toBe('https://api.example.test');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    // after URL normalisation the request is still /api/users/<one segment>
    expect(url.pathname.split('/').filter(Boolean)).toHaveLength(3);
    expect(url.pathname.startsWith('/api/users/')).toBe(true);
  });

  it.each(HOSTILE_IDS)('event layout: %j stays one path segment', async (id) => {
    await eventMetadata({ params: Promise.resolve({ id }) });
    const url = new URL(calls[calls.length - 1]);
    expect(url.search).toBe('');
    expect(url.pathname.split('/').filter(Boolean)).toHaveLength(3);
    expect(url.pathname.startsWith('/api/events/')).toBe(true);
  });
});
