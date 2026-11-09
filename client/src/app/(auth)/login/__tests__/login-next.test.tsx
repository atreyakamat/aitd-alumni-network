import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ setAuthData }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const login = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { get: vi.fn().mockResolvedValue({ data: { data: { google: true, linkedin: true } } }), post: vi.fn() },
    authApi: { ...actual.authApi, login: (...args: unknown[]) => login(...args) },
  };
});

import LoginPage from '@/app/(auth)/login/page';

const signIn = async () => {
  await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
  await userEvent.type(screen.getByLabelText(/^password/i), 'Secret123');
  await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  setAuthData.mockReset();
  login.mockReset().mockResolvedValue({
    data: { data: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } } },
  });
});

describe('login `next` return path', () => {
  it('returns to a safe relative path after signing in', async () => {
    search = new URLSearchParams('next=/events/42');
    render(<LoginPage />);
    await signIn();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/events/42'));
    expect(setAuthData).toHaveBeenCalled();
  });

  // The platform is private: a visitor who opens a shared link is sent to /login?next=<link> by the edge gate and lands on the link
  // after signing in.
  it.each(['/posts/123', '/search?q=x', '/events', '/events/42?tab=rsvp', '/gallery', '/news/some-slug', '/donations', '/chapters/c1', '/profile/abc'])(
    'brings the visitor back to the shared link %s they asked for',
    async (link) => {
      search = new URLSearchParams({ next: link });
      render(<LoginPage />);
      await signIn();
      await waitFor(() => expect(push).toHaveBeenCalledWith(link));
    }
  );

  it('ignores protocol-relative / absolute targets and falls back to the dashboard', async () => {
    search = new URLSearchParams('next=//evil.example.com');
    render(<LoginPage />);
    await signIn();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
  });

  it('carries the return path to the sign-up link', async () => {
    search = new URLSearchParams('next=/events/42');
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register?next=%2Fevents%2F42');
  });

  it('defaults to the dashboard without a next param', async () => {
    search = new URLSearchParams();
    render(<LoginPage />);
    await signIn();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
  });
});
