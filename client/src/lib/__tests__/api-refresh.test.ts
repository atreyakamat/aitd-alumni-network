import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api, refreshAccessToken } from '@/lib/api';

/**
 * Exercises the real response interceptor with a fake transport adapter:
 * strict refresh-token rotation means concurrent 401s must share ONE refresh.
 */

const unauthorized = (config: InternalAxiosRequestConfig, code = 'TOKEN_EXPIRED') =>
  Promise.reject(
    new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null, {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config,
      data: { success: false, error: { message: 'Token expired', code } },
    })
  );

const ok = (config: InternalAxiosRequestConfig, data: unknown) =>
  Promise.resolve({ status: 200, statusText: 'OK', headers: {}, config, data });

let originalAdapter: unknown;

beforeEach(() => {
  originalAdapter = api.defaults.adapter;
  localStorage.setItem('accessToken', 'old-access');
  localStorage.setItem('refreshToken', 'refresh-1');
});

afterEach(() => {
  api.defaults.adapter = originalAdapter as any;
  vi.restoreAllMocks();
});

const installAdapter = () => {
  const adapter = vi.fn<Parameters<AxiosAdapter>, ReturnType<AxiosAdapter>>((config) => {
    const auth = String(config.headers?.Authorization ?? '');
    if (auth === 'Bearer new-access') return ok(config, { success: true, data: { url: config.url } });
    return unauthorized(config);
  });
  api.defaults.adapter = adapter as unknown as AxiosAdapter;
  return adapter;
};

describe('401 refresh interceptor', () => {
  it('makes a single refresh call for concurrent 401s and retries all requests', async () => {
    const adapter = installAdapter();
    let resolveRefresh!: (v: unknown) => void;
    const refreshSpy = vi.spyOn(axios, 'post').mockImplementation(
      () => new Promise((resolve) => (resolveRefresh = resolve)) as any
    );

    const requests = Promise.all([api.get('/posts'), api.get('/events'), api.get('/jobs')]);

    // Let all three fail and queue on the refresh promise.
    await vi.waitFor(() => expect(refreshSpy).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/refresh-token$/), {
      refreshToken: 'refresh-1',
    });

    resolveRefresh({ data: { success: true, data: { accessToken: 'new-access', refreshToken: 'refresh-2' } } });
    const responses = await requests;

    expect(responses.map((r) => r.data.data.url)).toEqual(['/posts', '/events', '/jobs']);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    // 3 failures + 3 retries
    expect(adapter).toHaveBeenCalledTimes(6);
    // Rotated refresh token replaces the stored one.
    expect(localStorage.getItem('accessToken')).toBe('new-access');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-2');
  });

  it('starts a fresh refresh after the previous one settled', async () => {
    const refreshSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValueOnce({ data: { data: { accessToken: 'a1', refreshToken: 'r2' } } } as any)
      .mockResolvedValueOnce({ data: { data: { accessToken: 'a2', refreshToken: 'r3' } } } as any);

    await expect(refreshAccessToken()).resolves.toBe('a1');
    await expect(refreshAccessToken()).resolves.toBe('a2');
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(refreshSpy.mock.calls[1][1]).toEqual({ refreshToken: 'r2' });
  });

  it('clears the session when refresh fails, without retrying', async () => {
    const adapter = installAdapter();
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh token reused'));
    const expired = vi.fn();
    window.addEventListener('api:session_expired', expired);

    await expect(api.get('/posts')).rejects.toBeTruthy();
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(expired).toHaveBeenCalledTimes(1);
    window.removeEventListener('api:session_expired', expired);
  });

  it('does not refresh for credential errors like a wrong password', async () => {
    const refreshSpy = vi.spyOn(axios, 'post');
    api.defaults.adapter = ((config: InternalAxiosRequestConfig) =>
      unauthorized(config, 'INVALID_PASSWORD')) as unknown as AxiosAdapter;

    await expect(api.delete('/users/me', { data: { password: 'nope' } })).rejects.toMatchObject({
      response: { status: 401 },
    });
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('refreshToken')).toBe('refresh-1');
  });
});

describe('multi-tab refresh race', () => {
  const refreshRejected = (code: string) =>
    new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', undefined, null, {
      status: 401,
      statusText: 'Unauthorized',
      headers: {},
      config: {} as InternalAxiosRequestConfig,
      data: { success: false, error: { message: 'Invalid refresh token', code } },
    });

  it('adopts tokens another tab already rotated instead of logging out', async () => {
    const adapter = installAdapter();
    const expired = vi.fn();
    window.addEventListener('api:session_expired', expired);
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      // The other tab won the race and stored its rotated pair before we heard back
      localStorage.setItem('accessToken', 'new-access');
      localStorage.setItem('refreshToken', 'refresh-from-other-tab');
      throw refreshRejected('INVALID_REFRESH_TOKEN');
    });

    const res = await api.get('/posts');

    expect(res.data.data.url).toBe('/posts');
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter.mock.calls[1][0].headers.Authorization).toBe('Bearer new-access');
    expect(localStorage.getItem('refreshToken')).toBe('refresh-from-other-tab');
    expect(expired).not.toHaveBeenCalled();
    window.removeEventListener('api:session_expired', expired);
  });

  it('briefly waits for the winning tab to store its tokens after losing the race', async () => {
    installAdapter();
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      // Winner's response lands a moment after ours
      setTimeout(() => {
        localStorage.setItem('accessToken', 'new-access');
        localStorage.setItem('refreshToken', 'refresh-from-other-tab');
      }, 150);
      throw refreshRejected('INVALID_REFRESH_TOKEN');
    });

    await expect(refreshAccessToken()).resolves.toBe('new-access');
  });

  it('still logs out when the stored refresh token is unchanged', async () => {
    installAdapter();
    vi.spyOn(axios, 'post').mockRejectedValue(refreshRejected('REFRESH_TOKEN_REUSED'));

    await expect(api.get('/posts')).rejects.toBeTruthy();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('does not adopt a session when another tab logged out', async () => {
    vi.spyOn(axios, 'post').mockImplementation(async () => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      throw refreshRejected('INVALID_REFRESH_TOKEN');
    });

    await expect(refreshAccessToken()).rejects.toBeTruthy();
  });
});
