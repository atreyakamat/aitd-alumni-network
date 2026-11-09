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
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ setAuthData, isAuthenticated: false }) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const login = vi.fn();
const resendVerification = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      login: (...args: unknown[]) => login(...args),
      resendVerification: (...args: unknown[]) => resendVerification(...args),
    },
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
  toast.mockReset();
  login.mockReset();
  resendVerification.mockReset();
  search = new URLSearchParams();
  window.history.replaceState({}, '', '/login');
});

describe('signing in before the e-mail address is verified', () => {
  const notVerified = {
    response: { status: 403, data: { success: false, error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address before signing in.' } } },
  };

  it('explains what to do and offers to send the link again to the address that was typed', async () => {
    login.mockRejectedValue(notVerified);
    resendVerification.mockResolvedValue({
      data: { data: { message: 'If that address has an unverified account, a new verification link has been sent.' } },
    });
    render(<LoginPage />);
    await signIn();

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(/verify your email/i);
    expect(setAuthData).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith('ada@example.com'));
    expect(await screen.findByText(/new verification link has been sent/i)).toBeInTheDocument();
  });

  it('shows no verification notice for an ordinary wrong password', async () => {
    login.mockRejectedValue({ response: { status: 401, data: { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } } } });
    render(<LoginPage />);
    await signIn();
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /resend verification email/i })).not.toBeInTheDocument();
  });
});
