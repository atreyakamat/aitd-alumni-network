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

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, isAuthenticated: false }) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const register = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    authApi: { ...actual.authApi, register: (...args: unknown[]) => register(...args) },
  };
});

import RegisterPage from '@/app/(auth)/register/page';

const pick = async (trigger: string, option: string) => {
  await userEvent.click(screen.getByRole('combobox', { name: trigger }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
};

const fillAndSubmit = async () => {
  await userEvent.type(screen.getByLabelText('Full Name'), 'Ada Lovelace');
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com');
  const year = String(new Date().getFullYear() - 5);
  await pick('Batch year', year);
  await pick('Degree', 'B.Tech');
  await pick('Department', 'Computer Science');
  await userEvent.type(screen.getByLabelText('Password'), 'Secret123!x');
  await userEvent.type(screen.getByLabelText('Confirm Password'), 'Secret123!x');
  await userEvent.click(screen.getByRole('button', { name: 'Create Account' }));
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  toast.mockReset();
  register.mockReset().mockResolvedValue({ data: { success: true, data: {} } });
});

describe('register `next` passthrough', { timeout: 20000 }, () => {
  it('links "Sign in" to login with the same safe return path', async () => {
    search = new URLSearchParams('next=/events/42');
    render(<RegisterPage />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fevents%2F42');
  });

  it('sends the user to login with ?registered and the return path after signing up', async () => {
    search = new URLSearchParams('next=/events/42');
    render(<RegisterPage />);
    await fillAndSubmit();

    await waitFor(() => expect(register).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com', degree: 'B.Tech' })));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?registered=true&next=%2Fevents%2F42'));
  });

  it('drops unsafe return paths', async () => {
    search = new URLSearchParams('next=//evil.example.com');
    render(<RegisterPage />);
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    await fillAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login?registered=true'));
  });

  it('stays on the page and reports the error when registration fails', async () => {
    search = new URLSearchParams();
    register.mockRejectedValue({ response: { status: 409, data: { success: false, error: { message: 'Email already registered' } } } });
    render(<RegisterPage />);
    await fillAndSubmit();
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Email already registered' }))
    );
    expect(push).not.toHaveBeenCalled();
  });
});
