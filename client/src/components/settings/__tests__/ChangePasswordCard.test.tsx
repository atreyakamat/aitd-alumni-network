import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError } from 'axios';

const setAuthData = vi.fn();
const toast = vi.fn();
const changePassword = vi.fn();

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ setAuthData }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    authApi: { ...actual.authApi, changePassword: (...args: unknown[]) => changePassword(...args) },
  };
});

import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { evaluatePasswordRules } from '@/lib/auth';

const apiError = (status: number, code: string, message: string) =>
  new AxiosError(message, 'ERR_BAD_REQUEST', undefined, null, {
    status,
    statusText: '',
    headers: {},
    config: {} as any,
    data: { success: false, error: { message, code } },
  });

const fill = async (current: string, next: string, confirm = next) => {
  if (current) await userEvent.type(screen.getByLabelText(/^current password/i), current);
  if (next) await userEvent.type(screen.getByLabelText(/^new password/i), next);
  if (confirm) await userEvent.type(screen.getByLabelText(/^confirm new password/i), confirm);
};

const submit = () => userEvent.click(screen.getByRole('button', { name: /change password/i }));

beforeEach(() => {
  setAuthData.mockReset();
  toast.mockReset();
  changePassword.mockReset();
});

describe('evaluatePasswordRules', () => {
  it('mirrors the server policy (8-128 chars, upper, lower, digit)', () => {
    const met = (pw: string) => evaluatePasswordRules(pw).filter((r) => r.met).map((r) => r.id);
    expect(met('')).toEqual([]);
    expect(met('abcdefgh')).toEqual(['length', 'lowercase']);
    expect(met('Abcdefg1')).toEqual(['length', 'uppercase', 'lowercase', 'number']);
    expect(met('A1' + 'a'.repeat(127))).toEqual(['uppercase', 'lowercase', 'number']);
  });
});

describe('<ChangePasswordCard>', () => {
  it('shows live strength hints for the new password', async () => {
    render(<ChangePasswordCard />);
    const hint = (name: RegExp) => screen.getByText(name).closest('li')!;
    expect(hint(/at least 8 characters/i)).toHaveAttribute('data-met', 'false');

    await userEvent.type(screen.getByLabelText(/^new password/i), 'Abcdefg1');
    expect(hint(/at least 8 characters/i)).toHaveAttribute('data-met', 'true');
    expect(hint(/uppercase/i)).toHaveAttribute('data-met', 'true');
    expect(hint(/lowercase/i)).toHaveAttribute('data-met', 'true');
    expect(hint(/number/i)).toHaveAttribute('data-met', 'true');
  });

  it('validates on the client before calling the API', async () => {
    render(<ChangePasswordCard />);

    await fill('Current#1', 'weakpass');
    await submit();
    expect(await screen.findByText(/at least one uppercase/i)).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/^new password/i));
    await userEvent.type(screen.getByLabelText(/^new password/i), 'Brand#New2026');
    await userEvent.clear(screen.getByLabelText(/^confirm new password/i));
    await userEvent.type(screen.getByLabelText(/^confirm new password/i), 'Brand#New2027');
    await submit();
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();

    expect(changePassword).not.toHaveBeenCalled();
  });

  it('rejects reusing the current password', async () => {
    render(<ChangePasswordCard />);
    await fill('Same#Pass1', 'Same#Pass1');
    await submit();
    expect(await screen.findByText(/must be different/i)).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('stores the new session tokens, toasts and clears the form on success', async () => {
    changePassword.mockResolvedValue({
      data: { success: true, data: { accessToken: 'new-access', refreshToken: 'new-refresh', message: 'ok' } },
    });
    render(<ChangePasswordCard />);
    await fill('Current#1', 'Brand#New2026');
    await submit();

    await waitFor(() =>
      expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'Current#1', newPassword: 'Brand#New2026' })
    );
    await waitFor(() => expect(setAuthData).toHaveBeenCalledWith({ accessToken: 'new-access', refreshToken: 'new-refresh' }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/password changed/i) }));
    expect(screen.getByLabelText(/^current password/i)).toHaveValue('');
    expect(screen.getByLabelText(/^new password/i)).toHaveValue('');
  });

  it('shows the server error message (e.g. wrong current password) and keeps the session', async () => {
    changePassword.mockRejectedValue(apiError(401, 'INVALID_PASSWORD', 'Current password is incorrect'));
    render(<ChangePasswordCard />);
    await fill('Wrong#Pass1', 'Brand#New2026');
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(setAuthData).not.toHaveBeenCalled();
  });

  it('explains password reset for OAuth-only accounts', async () => {
    changePassword.mockRejectedValue(
      apiError(400, 'PASSWORD_NOT_SET', 'Your account signs in with Google or LinkedIn and has no password yet.')
    );
    render(<ChangePasswordCard />);
    await fill('anything', 'Brand#New2026');
    await submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/google or linkedin/i);
    expect(screen.getByRole('link', { name: /reset/i })).toHaveAttribute('href', '/forgot-password');
  });
});
