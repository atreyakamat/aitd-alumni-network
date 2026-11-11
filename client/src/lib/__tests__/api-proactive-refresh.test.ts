import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api, resetProactiveRefreshGuard, tokenExpiresAt } from '@/lib/api';

/**
 * Coming back to the app after the 15-minute access token ran out used to cost a failed request (a red 401 in the
 * console) before the session was renewed. When the token itself says it has expired, renew first.
 */

const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (expSecondsFromNow: number) => `${b64({ alg: 'HS256' })}.${b64({ userId: 'u1', exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })}.sig`;

let originalAdapter: unknown;
let seenAuth: Array<string | undefined>;

const installAdapter = () => {
  api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    seenAuth.push(config.headers?.Authorization as string | undefined);
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  }) as unknown as AxiosAdapter;
};

beforeEach(() => {
  originalAdapter = api.defaults.adapter;
  seenAuth = [];
  resetProactiveRefreshGuard();
  localStorage.setItem('refreshToken', 'refresh-1');
  installAdapter();
});

afterEach(() => {
  api.defaults.adapter = originalAdapter as AxiosAdapter;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('tokenExpiresAt', () => {
  it('reads the expiry of a JWT in milliseconds, and says nothing about anything else', () => {
    const token = jwt(600);
    expect(tokenExpiresAt(token)!).toBeGreaterThan(Date.now() + 590_000);
    expect(tokenExpiresAt('opaque-token')).toBeNull();
    expect(tokenExpiresAt('a.b.c')).toBeNull();
    expect(tokenExpiresAt(`${b64({})}.${b64({ userId: 'u1' })}.sig`)).toBeNull();
  });
});

describe('renewing an expired access token before the request', () => {
  it('renews first, then sends the request with the new token (no failed request in between)', async () => {
    localStorage.setItem('accessToken', jwt(-120));
    const refresh = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { data: { accessToken: 'fresh-access', refreshToken: 'refresh-2' } } } as never);

    await api.get('/events');

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seenAuth).toEqual(['Bearer fresh-access']);
    expect(localStorage.getItem('refreshToken')).toBe('refresh-2');
  });

  it('leaves a token that is still valid alone', async () => {
    localStorage.setItem('accessToken', jwt(600));
    const refresh = vi.spyOn(axios, 'post');

    await api.get('/events');

    expect(refresh).not.toHaveBeenCalled();
    expect(seenAuth).toHaveLength(1);
  });

  it('does not guess about a token it cannot read', async () => {
    localStorage.setItem('accessToken', 'opaque-token');
    const refresh = vi.spyOn(axios, 'post');

    await api.get('/events');

    expect(refresh).not.toHaveBeenCalled();
    expect(seenAuth).toEqual(['Bearer opaque-token']);
  });

  it('does nothing without a refresh token, and never for the sign-in and refresh calls themselves', async () => {
    localStorage.setItem('accessToken', jwt(-120));
    const refresh = vi.spyOn(axios, 'post');

    localStorage.removeItem('refreshToken');
    await api.get('/events');
    localStorage.setItem('refreshToken', 'refresh-1');
    await api.post('/auth/login', { email: 'a@b.c', password: 'x' });

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not renew on every request when this computer\'s clock is wrong: at most once a minute', async () => {
    // the new token also looks expired because the clock is ahead of the server's
    localStorage.setItem('accessToken', jwt(-120));
    const refresh = vi.spyOn(axios, 'post').mockImplementation(async () => {
      return { data: { data: { accessToken: jwt(-120), refreshToken: 'refresh-n' } } } as never;
    });

    await api.get('/events');
    await api.get('/jobs');
    await api.get('/news');

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seenAuth).toHaveLength(3);
  });

  it('still sends the request if the renewal fails: the server then decides, as before', async () => {
    localStorage.setItem('accessToken', jwt(-120));
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('offline'));

    await api.get('/events');

    expect(seenAuth).toHaveLength(1);
  });
});
