import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

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
const authState: { isAuthenticated: boolean } = { isAuthenticated: false };
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ setAuthData, isAuthenticated: authState.isAuthenticated }) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const post = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { get: vi.fn().mockResolvedValue({ data: { data: { google: true, linkedin: true } } }), post: (...a: unknown[]) => post(...a) },
  };
});

import LoginPage from '@/app/(auth)/login/page';

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  setAuthData.mockReset();
  post.mockReset();
  toast.mockReset();
  authState.isAuthenticated = false;
});

describe('OAuth hand-off on /login', () => {
  it('removes the one-time code from the address bar before the exchange resolves', async () => {
    search = new URLSearchParams('code=ONE-TIME-CODE&oauth=google&newUser=false&next=/events/9');
    window.history.replaceState({}, '', '/login?code=ONE-TIME-CODE&oauth=google&newUser=false&next=/events/9');
    const replaceState = vi.spyOn(window.history, 'replaceState');

    let resolveExchange!: (v: unknown) => void;
    post.mockReturnValue(new Promise((resolve) => (resolveExchange = resolve)));

    render(<LoginPage />);

    // URL is cleaned synchronously on mount, while the exchange is still pending.
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(window.location.search).not.toContain('code=');
    expect(window.location.search).not.toContain('ONE-TIME-CODE');
    expect(window.location.search).toContain('next=');
    expect(replaceState).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/auth/oauth/exchange', { code: 'ONE-TIME-CODE' });

    resolveExchange({ data: { data: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } } } });
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/events/9'));
    expect(setAuthData).toHaveBeenCalledTimes(1);
  });

  it('exchanges the code only once even if the effect runs twice', async () => {
    search = new URLSearchParams('code=C1&oauth=linkedin');
    window.history.replaceState({}, '', '/login?code=C1&oauth=linkedin');
    post.mockResolvedValue({ data: { data: { accessToken: 'a', refreshToken: 'r' } } });
    const { rerender } = render(<LoginPage />);
    search = new URLSearchParams(''); // router reflects the stripped URL
    rerender(<LoginPage />);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('never logs the code or tokens', async () => {
    search = new URLSearchParams('code=SECRETCODE&oauth=google');
    window.history.replaceState({}, '', '/login?code=SECRETCODE&oauth=google');
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    post.mockResolvedValue({ data: { data: { accessToken: 'ACCESS-TOKEN-X', refreshToken: 'REFRESH-TOKEN-X' } } });
    render(<LoginPage />);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain('SECRETCODE');
    expect(logged).not.toContain('TOKEN-X');
  });
});

describe('already signed-in visitors', () => {
  it('are sent on to the safe next path instead of seeing the sign-in form', async () => {
    authState.isAuthenticated = true;
    search = new URLSearchParams('next=/jobs');
    window.history.replaceState({}, '', '/login?next=/jobs');
    render(<LoginPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/jobs'));
  });

  it('ignore an unsafe next and land on the dashboard', async () => {
    authState.isAuthenticated = true;
    search = new URLSearchParams('next=//evil.example.com');
    window.history.replaceState({}, '', '/login');
    render(<LoginPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
