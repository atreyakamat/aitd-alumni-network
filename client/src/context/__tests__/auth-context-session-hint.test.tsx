import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { hasSessionHint } from '@/lib/session-hint';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const me = vi.fn();
const login = vi.fn();
const logoutApi = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      me: (...a: unknown[]) => me(...a),
      login: (...a: unknown[]) => login(...a),
      logout: (...a: unknown[]) => logoutApi(...a),
    },
  };
});

import { AuthProvider, useAuth } from '@/context/auth-context';

const tokenFor = (userId: string) => `h.${btoa(JSON.stringify({ userId })).replace(/=+$/, '')}.sig`;
const profile = (id: string) => ({ data: { data: { id, email: `${id}@aitd.test`, fullName: id, userRole: 'MEMBER' } } });

let ctx: ReturnType<typeof useAuth>;
function Probe() {
  ctx = useAuth();
  return <p data-testid="state">{ctx.isLoading ? 'loading' : ctx.user ? ctx.user.email : 'anonymous'}</p>;
}
const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>
  );
const cookieSet = () => hasSessionHint(document.cookie);

beforeEach(() => {
  me.mockReset();
  login.mockReset();
  logoutApi.mockReset();
  document.cookie = 'aitd_session=; Path=/; Max-Age=0';
});

describe('aitd_session hint cookie follows the session', () => {
  it('is set when a stored session is confirmed by /auth/me on load', async () => {
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockResolvedValue(profile('u1'));
    mount();
    expect(await screen.findByText('u1@aitd.test')).toBeInTheDocument();
    expect(cookieSet()).toBe(true);
  });

  it('is cleared when /auth/me rejects the stored session (401)', async () => {
    document.cookie = 'aitd_session=1; Path=/';
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockRejectedValue({ response: { status: 401 } });
    mount();
    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(cookieSet()).toBe(false);
  });

  it('is cleared on load when there are no stored tokens', async () => {
    document.cookie = 'aitd_session=1; Path=/';
    mount();
    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(cookieSet()).toBe(false);
  });

  it('is kept across a transient network error (tokens are kept too)', async () => {
    document.cookie = 'aitd_session=1; Path=/';
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockRejectedValue(new Error('Network Error'));
    mount();
    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(cookieSet()).toBe(true);
  });

  it('is set on login and cleared on logout', async () => {
    me.mockResolvedValue(profile('u1'));
    login.mockResolvedValue({
      data: { data: { accessToken: tokenFor('u1'), refreshToken: 'r1', user: { id: 'u1', email: 'u1@aitd.test', fullName: 'u1', userRole: 'MEMBER' } } },
    });
    logoutApi.mockResolvedValue({});
    mount();
    await screen.findByText('anonymous');
    expect(cookieSet()).toBe(false);

    await act(async () => {
      await ctx.login('u1@aitd.test', 'pw');
    });
    expect(cookieSet()).toBe(true);

    await act(async () => {
      await ctx.logout();
    });
    expect(cookieSet()).toBe(false);
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('is cleared even when the logout request fails', async () => {
    document.cookie = 'aitd_session=1; Path=/';
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockResolvedValue(profile('u1'));
    logoutApi.mockRejectedValue(new Error('offline'));
    mount();
    await screen.findByText('u1@aitd.test');
    await act(async () => {
      await ctx.logout().catch(() => undefined);
    });
    expect(cookieSet()).toBe(false);
  });

  it('is set by setAuthData (2FA completion / password change) and cleared by clearSession', async () => {
    mount();
    await screen.findByText('anonymous');
    act(() => ctx.setAuthData({ accessToken: tokenFor('u2'), refreshToken: 'r2' }));
    expect(cookieSet()).toBe(true);
    act(() => ctx.clearSession());
    expect(cookieSet()).toBe(false);
  });

  it('is cleared when another tab logs out', async () => {
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockResolvedValue(profile('u1'));
    mount();
    await screen.findByText('u1@aitd.test');
    expect(cookieSet()).toBe(true);

    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'accessToken', newValue: null, storageArea: localStorage }));
    });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anonymous'));
    expect(cookieSet()).toBe(false);
  });
});
