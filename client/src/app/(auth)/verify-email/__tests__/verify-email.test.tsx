import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let search = new URLSearchParams();
const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
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
  push.mockReset();
  replace.mockReset();
  verifyEmail.mockReset();
  resendVerification.mockReset();
  search = new URLSearchParams('token=abc123');
});

describe('/verify-email (the link in the registration e-mail)', () => {
  const REVIEW_MESSAGE =
    'Email verified. An administrator now checks that you are an alumnus of the college; you will be told by e-mail when your account is approved.';

  const confirmWithPassword = async () => {
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'My#Passw0rd1' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm email/i }));
  };

  it('asks for the registration password and sends it with the token', async () => {
    verifyEmail.mockResolvedValue({ data: { data: { message: REVIEW_MESSAGE } } });
    render(<VerifyEmailPage />);

    await confirmWithPassword();

    await waitFor(() => expect(verifyEmail).toHaveBeenCalledWith('abc123', 'My#Passw0rd1'));
    expect(await screen.findByText(REVIEW_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
  });

  it('shows what the server says comes next: an administrator reviews the registration', async () => {
    verifyEmail.mockResolvedValue({ data: { success: true, data: { message: REVIEW_MESSAGE } } });
    render(<VerifyEmailPage />);
    await confirmWithPassword();

    expect(await screen.findByRole('heading', { name: /email verified/i })).toBeInTheDocument();
    expect(screen.getByText(/administrator now checks/i)).toBeInTheDocument();
  });

  it('does not claim the account is active, and does not send the person to the dashboard (there is no session)', async () => {
    verifyEmail.mockResolvedValue({ data: { data: { message: REVIEW_MESSAGE } } });
    render(<VerifyEmailPage />);
    await confirmWithPassword();
    await screen.findByText(REVIEW_MESSAGE);

    expect(screen.queryByText(/you can sign in now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/account is (now )?active/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(localStorage.getItem('accessToken')).toBeNull();
  });

  it('shows the server message as plain text, never as HTML', async () => {
    verifyEmail.mockResolvedValue({ data: { data: { message: '<img src=x onerror=alert(1)> Email verified' } } });
    const { container } = render(<VerifyEmailPage />);
    await confirmWithPassword();
    await screen.findByText('<img src=x onerror=alert(1)> Email verified');
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to a message about the review when the server sends none', async () => {
    verifyEmail.mockResolvedValue({ data: { data: {} } });
    render(<VerifyEmailPage />);
    await confirmWithPassword();
    expect(await screen.findByText(/administrator/i)).toBeInTheDocument();
    expect(screen.queryByText(/you can sign in now/i)).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'me@aiem.edu' } });
    fireEvent.click(screen.getByRole('button', { name: /send a new link/i }));

    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith('me@aiem.edu'));
    expect(await screen.findByText(/new verification link has been sent/i)).toBeInTheDocument();
  });

  it('without a token in the address it goes straight to requesting a new link', async () => {
    search = new URLSearchParams('');
    render(<VerifyEmailPage />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send a new link/i })).toBeInTheDocument();
  });
});
