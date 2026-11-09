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

const login = vi.fn();
const verify2FA = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    api: { get: vi.fn().mockResolvedValue({ data: { data: { google: true, linkedin: true } } }), post: (...a: unknown[]) => post(...a) },
    authApi: { ...actual.authApi, login: (...args: unknown[]) => login(...args) },
    twoFactorApi: { ...actual.twoFactorApi, verify2FA: (...args: unknown[]) => verify2FA(...args) },
  };
});

import LoginPage from '@/app/(auth)/login/page';

/** What the server sends: HTTP 403 with the code in error.code (server/src/utils/approval.ts). */
const pending = {
  response: {
    status: 403,
    data: {
      success: false,
      error: {
        code: 'ACCOUNT_PENDING_APPROVAL',
        message: 'Your registration is waiting for approval. An administrator checks that every member is an alumnus of the college.',
      },
    },
  },
};
const rejected = {
  response: {
    status: 403,
    data: { success: false, error: { code: 'ACCOUNT_REJECTED', message: 'Your registration was not approved. Check your e-mail for the reason, or contact the alumni office.' } },
  },
};

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
  verify2FA.mockReset();
  post.mockReset();
  search = new URLSearchParams();
  window.history.replaceState({}, '', '/login');
});

/** Renders and lets the page's own start-up request (the OAuth provider list) settle, so no update lands outside act(). */
const renderSettled = async () => {
  await act(async () => {
    render(<LoginPage />);
  });
};

const expectNoErrorToast = () => {
  expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }));
};

describe('signing in while the registration is waiting for approval', () => {
  it('shows a calm notice that says what to expect, not the generic red error', async () => {
    login.mockRejectedValue(pending);
    render(<LoginPage />);
    await signIn();

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/your registration is waiting for approval/i);
    expect(notice).toHaveTextContent(/administrator/i);
    expect(notice).toHaveTextContent(/e-mail/i);
    expectNoErrorToast();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(setAuthData).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('is not mistaken for an unverified e-mail address (no "resend verification" offer)', async () => {
    login.mockRejectedValue(pending);
    render(<LoginPage />);
    await signIn();
    await screen.findByRole('status');
    expect(screen.queryByRole('button', { name: /resend verification email/i })).not.toBeInTheDocument();
  });

  it('goes away when the person tries again and gets in', async () => {
    login.mockRejectedValueOnce(pending).mockResolvedValue({ data: { data: { accessToken: 'a', refreshToken: 'r', user: { id: 'u1' } } } });
    render(<LoginPage />);
    await signIn();
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('signing in after the registration was rejected', () => {
  it('says it was not approved and points to the e-mail and the alumni office', async () => {
    login.mockRejectedValue(rejected);
    render(<LoginPage />);
    await signIn();

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/not approved/i);
    expect(notice).toHaveTextContent(/e-mail for the reason/i);
    expect(notice).toHaveTextContent(/alumni office/i);
    expectNoErrorToast();
    expect(setAuthData).not.toHaveBeenCalled();
  });
});

describe('the two-factor step', () => {
  it('leads back to the sign-in form with the notice when the account is not approved', async () => {
    login.mockResolvedValue({ data: { data: { requires2FA: true, twoFactorToken: 'challenge' } } });
    verify2FA.mockRejectedValue(pending);
    render(<LoginPage />);
    await signIn();

    await userEvent.type(await screen.findByLabelText(/verification code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/waiting for approval/i);
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/verification code/i)).not.toBeInTheDocument();
    expectNoErrorToast();
    expect(setAuthData).not.toHaveBeenCalled();
  });
});

describe('OAuth sign-in (the one-time code on /login)', () => {
  it('shows the notice instead of "Login Failed" when the provider account is not approved', async () => {
    search = new URLSearchParams('code=ONE-TIME&oauth=google');
    window.history.replaceState({}, '', '/login?code=ONE-TIME&oauth=google');
    post.mockRejectedValue(pending);

    render(<LoginPage />);

    expect(await screen.findByRole('status')).toHaveTextContent(/waiting for approval/i);
    expectNoErrorToast();
    expect(setAuthData).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('says so for a rejected registration too', async () => {
    search = new URLSearchParams('code=ONE-TIME&oauth=linkedin');
    window.history.replaceState({}, '', '/login?code=ONE-TIME&oauth=linkedin');
    post.mockRejectedValue(rejected);

    render(<LoginPage />);

    expect(await screen.findByRole('status')).toHaveTextContent(/not approved/i);
  });

  it('still reports any other exchange failure as an error', async () => {
    search = new URLSearchParams('code=ONE-TIME&oauth=google');
    window.history.replaceState({}, '', '/login?code=ONE-TIME&oauth=google');
    post.mockRejectedValue({ response: { status: 400, data: { success: false, error: { code: 'INVALID_OAUTH_CODE', message: 'Expired' } } } });

    render(<LoginPage />);

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Login Failed' })));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('arriving after the session was ended because the approval was taken back', () => {
  it('shows the pending notice for ?approval=pending', async () => {
    search = new URLSearchParams('approval=pending');
    await renderSettled();
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for approval/i);
  });

  it('shows the rejected notice for ?approval=rejected', async () => {
    search = new URLSearchParams('approval=rejected');
    await renderSettled();
    expect(screen.getByRole('status')).toHaveTextContent(/not approved/i);
  });

  it.each(['', 'approved', '<script>alert(1)</script>', 'PENDING'])('ignores ?approval=%s', async (value) => {
    search = new URLSearchParams({ approval: value });
    await renderSettled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('after registering', () => {
  it('the banner says an administrator still has to approve (the account is not usable yet)', async () => {
    search = new URLSearchParams('registered=true');
    await renderSettled();
    const banner = screen.getByText(/registration received/i).parentElement as HTMLElement;
    expect(banner).toHaveTextContent(/verify your e-mail/i);
    expect(banner).toHaveTextContent(/administrator/i);
    expect(banner).toHaveTextContent(/approved/i);
  });
});
