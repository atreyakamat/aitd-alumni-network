import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const me = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, authApi: { ...actual.authApi, me: (...args: unknown[]) => me(...args) } };
});

import { AuthProvider, useAuth } from '@/context/auth-context';

/** Unsigned JWT-shaped token; the client only reads the payload. */
const tokenFor = (userId: string, n = 1) =>
  `h.${btoa(JSON.stringify({ userId, n })).replace(/=+$/, '')}.sig`;

const profile = (id: string) => ({ data: { data: { id, email: `${id}@aitd.test`, fullName: id, userRole: 'MEMBER' } } });

function Who() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <p>loading</p>;
  return <p data-testid="who">{user ? user.email : 'anonymous'}</p>;
}

/** What the browser fires in OTHER tabs after this one writes localStorage. */
const otherTabWrites = (key: string, newValue: string | null) => {
  const oldValue = localStorage.getItem(key);
  if (newValue === null) localStorage.removeItem(key);
  else localStorage.setItem(key, newValue);
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue, storageArea: localStorage }));
  });
};

const renderProvider = () =>
  render(
    <AuthProvider>
      <Who />
    </AuthProvider>
  );

beforeEach(() => {
  me.mockReset();
});

describe('AuthProvider cross-tab sync', () => {
  it('signs this tab out when another tab logs out', async () => {
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockResolvedValue(profile('u1'));
    renderProvider();
    expect(await screen.findByText('u1@aitd.test')).toBeInTheDocument();

    otherTabWrites('refreshToken', null);
    otherTabWrites('accessToken', null);

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anonymous'));
  });

  it('picks up a sign-in from another tab', async () => {
    renderProvider();
    expect(await screen.findByText('anonymous')).toBeInTheDocument();
    expect(me).not.toHaveBeenCalled();

    me.mockResolvedValue(profile('u2'));
    otherTabWrites('refreshToken', 'r2');
    otherTabWrites('accessToken', tokenFor('u2'));

    expect(await screen.findByText('u2@aitd.test')).toBeInTheDocument();
  });

  it('ignores token rotation for the same user (no refetch, stays signed in)', async () => {
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockResolvedValue(profile('u1'));
    renderProvider();
    expect(await screen.findByText('u1@aitd.test')).toBeInTheDocument();
    expect(me).toHaveBeenCalledTimes(1);

    otherTabWrites('accessToken', tokenFor('u1', 2));
    otherTabWrites('refreshToken', 'r1-rotated');

    expect(screen.getByTestId('who')).toHaveTextContent('u1@aitd.test');
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('reloads the profile when another tab signs in as a different user', async () => {
    localStorage.setItem('accessToken', tokenFor('u1'));
    me.mockResolvedValue(profile('u1'));
    renderProvider();
    expect(await screen.findByText('u1@aitd.test')).toBeInTheDocument();

    me.mockResolvedValue(profile('u3'));
    otherTabWrites('accessToken', tokenFor('u3'));

    expect(await screen.findByText('u3@aitd.test')).toBeInTheDocument();
  });
});

describe('AuthProvider profile load failures', () => {
  it('keeps the session when the profile request fails for a non-auth reason (network/5xx)', async () => {
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true, response: undefined }));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('who')).toBeInTheDocument());
    // Tokens survive, so other tabs are not signed out by a network blip
    expect(localStorage.getItem('accessToken')).toBe(tokenFor('u1'));
    expect(localStorage.getItem('refreshToken')).toBe('r1');
  });

  it('clears the session when the server rejects the credentials', async () => {
    localStorage.setItem('accessToken', tokenFor('u1'));
    localStorage.setItem('refreshToken', 'r1');
    me.mockRejectedValue(Object.assign(new Error('Unauthorized'), { isAxiosError: true, response: { status: 401 } }));
    renderProvider();

    await waitFor(() => expect(screen.getByTestId('who')).toHaveTextContent('anonymous'));
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
  });
});
