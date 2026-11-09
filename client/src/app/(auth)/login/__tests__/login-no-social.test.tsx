import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
const replace = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => search,
}));

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill, priority, ...props }: any) => <img {...props} />,
}));

const setAuthData = vi.fn();
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ setAuthData, isAuthenticated: false }) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { api } from '@/lib/api';
import LoginPage from '@/app/(auth)/login/page';

/** The real axios instance of the app, with its transport replaced: every request the page makes ends up here. */
const adapter = vi.fn();

const answer = (config: unknown, data: unknown) => ({ data, status: 200, statusText: 'OK', headers: {}, config });

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  setAuthData.mockReset();
  toast.mockReset();
  adapter.mockReset().mockImplementation(async (config: unknown) =>
    answer(config, { success: true, data: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } } })
  );
  (api.defaults as { adapter: unknown }).adapter = adapter;
  search = new URLSearchParams();
  window.history.replaceState({}, '', '/login');
});

describe('the sign-in page has one way in: the password form', () => {
  it('offers no Google or LinkedIn button and no "continue with" divider', async () => {
    await act(async () => {
      render(<LoginPage />);
    });

    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /linkedin/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/or continue with/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/oauth|social provider/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign up/i })).toBeInTheDocument();
  });

  it('sends no request when it opens (there is no provider list to fetch)', async () => {
    await act(async () => {
      render(<LoginPage />);
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('ignores an old hand-off link: a ?code= is not exchanged, nothing is signed in, no error is shown', async () => {
    search = new URLSearchParams('code=ONE-TIME&oauth=google&newUser=true');
    window.history.replaceState({}, '', '/login?code=ONE-TIME&oauth=google&newUser=true');

    await act(async () => {
      render(<LoginPage />);
    });

    expect(adapter).not.toHaveBeenCalled();
    expect(setAuthData).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows no provider error for an old ?error=oauth_failed link', async () => {
    search = new URLSearchParams('error=oauth_failed');
    await act(async () => {
      render(<LoginPage />);
    });
    expect(toast).not.toHaveBeenCalled();
    expect(screen.queryByText(/oauth|provider/i)).not.toBeInTheDocument();
  });

  it('still signs a member in with e-mail and password, through POST /auth/login only', async () => {
    render(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.type(screen.getByLabelText(/^password/i), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
    expect(setAuthData).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'a' }));
    const calls = adapter.mock.calls.map(([config]) => `${String(config.method).toUpperCase()} ${config.url}`);
    expect(calls).toEqual(['POST /auth/login']);
  });
});
