import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => search,
}));

const verifyEmail = vi.fn();
const resendVerification = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    authApi: {
      ...actual.authApi,
      verifyEmail: (...args: unknown[]) => verifyEmail(...args),
      resendVerification: (...args: unknown[]) => resendVerification(...args),
    },
  };
});

import VerifyEmailPage from '@/app/(auth)/verify-email/page';

const apiError = (code: string, message = 'nope') => ({ response: { status: 400, data: { success: false, error: { code, message } } } });

beforeEach(() => {
  verifyEmail.mockReset();
  resendVerification.mockReset();
  search = new URLSearchParams('token=abc123');
});

describe('/verify-email (the link in the registration e-mail)', () => {
  it('asks for the registration password and sends it with the token', async () => {
    verifyEmail.mockResolvedValue({ data: { data: { message: 'Email verified successfully' } } });
    render(<VerifyEmailPage />);

    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'My#Passw0rd1' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm email/i }));

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith('abc123', 'My#Passw0rd1'));
    expect(await screen.findByText(/email address is verified/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
  });

  it('does not call the API without a password', async () => {
    render(<VerifyEmailPage />);
    fireEvent.click(screen.getByRole('button', { name: /confirm email/i }));
    expect(verifyEmail).not.toHaveBeenCalled();
  });

  it('explains a wrong password and keeps the form so the member can retry', async () => {
    verifyEmail.mockRejectedValue(apiError('VERIFY_PASSWORD_INVALID'));
    render(<VerifyEmailPage />);

    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm email/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not the password/i);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('tells a member who got a link they did not ask for what to do', async () => {
    render(<VerifyEmailPage />);
    expect(screen.getByText(/did not create an account/i)).toBeInTheDocument();
  });

  it('shows the lock-out message when too many wrong passwords were tried', async () => {
    verifyEmail.mockRejectedValue({ response: { status: 429, data: { success: false, error: { code: 'PASSWORD_ATTEMPTS_EXCEEDED', message: 'Too many' } } } });
    render(<VerifyEmailPage />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm email/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many/i);
  });

  it('offers a new link when this one is invalid or expired, and sends it to the address typed', async () => {
    verifyEmail.mockRejectedValue(apiError('INVALID_TOKEN'));
    resendVerification.mockResolvedValue({ data: { data: { message: 'If that address has an unverified account, a new verification link has been sent.' } } });
    render(<VerifyEmailPage />);

    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'My#Passw0rd1' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm email/i }));
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'me@aitd.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send a new link/i }));

    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith('me@aitd.edu'));
    expect(await screen.findByText(/new verification link has been sent/i)).toBeInTheDocument();
  });

  it('without a token in the address it goes straight to requesting a new link', async () => {
    search = new URLSearchParams('');
    render(<VerifyEmailPage />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send a new link/i })).toBeInTheDocument();
  });
});
