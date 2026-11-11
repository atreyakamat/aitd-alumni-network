import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: ({ fill, priority, ...props }: any) => <img {...props} />,
}));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, isAuthenticated: false, setAuthData: vi.fn() }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import LoginPage from '@/app/(auth)/login/page';
import RegisterPage from '@/app/(auth)/register/page';

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('the "show password" buttons can be used with a screen reader and the keyboard', () => {
  it('login: the button has a name and says whether the password is showing', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveAttribute('type', 'password');

    await user.click(toggle);

    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Password', { selector: 'input' })).toHaveAttribute('type', 'text');
  });

  it('register: both password fields have their own named button', async () => {
    const user = userEvent.setup();
    render(<RegisterPage />);

    const show = screen.getAllByRole('button', { name: /^Show (confirmation )?password$/ });
    expect(show.map((button) => button.getAttribute('aria-label'))).toEqual(['Show password', 'Show confirmation password']);

    await user.click(show[1]);
    expect(screen.getByRole('button', { name: 'Hide confirmation password' })).toHaveAttribute('aria-pressed', 'true');
    // the first field is unaffected
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the registration page does not overclaim', () => {
  it('does not advertise "thousands" of alumni on a private network that an administrator curates', () => {
    render(<RegisterPage />);
    expect(screen.queryByText(/thousands/i)).not.toBeInTheDocument();
  });
});
