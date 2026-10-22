import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }) }));

const authState: { user: any; isLoading: boolean } = { user: null, isLoading: false };
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

import { RequireRole } from '@/components/auth/RequireRole';

const setAuth = (user: any, isLoading = false) => {
  authState.user = user;
  authState.isLoading = isLoading;
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  setAuth(null);
});

describe('<RequireRole>', () => {
  it('renders children for users meeting the minimum role', () => {
    setAuth({ id: '1', role: 'ADMIN' });
    render(
      <RequireRole min="ADMIN">
        <p>secret admin content</p>
      </RequireRole>
    );
    expect(screen.getByText('secret admin content')).toBeInTheDocument();
  });

  it('allows higher roles (SUPER_ADMIN passes an ADMIN gate)', () => {
    setAuth({ id: '1', userRole: 'super_admin' });
    render(
      <RequireRole min="ADMIN">
        <p>secret admin content</p>
      </RequireRole>
    );
    expect(screen.getByText('secret admin content')).toBeInTheDocument();
  });

  it('shows an access denied state for lower roles and hides children', () => {
    setAuth({ id: '1', role: 'CHAPTER_ADMIN' });
    render(
      <RequireRole min="ADMIN">
        <p>secret admin content</p>
      </RequireRole>
    );
    expect(screen.queryByText('secret admin content')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /access denied/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute('href', '/dashboard');
  });

  it('treats unknown roles as MEMBER', () => {
    setAuth({ id: '1', role: 'WIZARD' });
    render(
      <RequireRole min="CHAPTER_ADMIN">
        <p>chapter tools</p>
      </RequireRole>
    );
    expect(screen.queryByText('chapter tools')).not.toBeInTheDocument();
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
  });

  it('shows a loading state while auth resolves, without leaking children', () => {
    setAuth(null, true);
    render(
      <RequireRole min="ADMIN">
        <p>secret admin content</p>
      </RequireRole>
    );
    expect(screen.queryByText('secret admin content')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/checking access/i);
  });

  it('renders a custom fallback when provided', () => {
    setAuth({ id: '1', role: 'MEMBER' });
    render(
      <RequireRole min="ADMIN" fallback={<span>nope</span>}>
        <p>secret admin content</p>
      </RequireRole>
    );
    expect(screen.getByText('nope')).toBeInTheDocument();
  });

  it('redirects when redirectTo is set and access is denied', () => {
    setAuth({ id: '1', role: 'MEMBER' });
    render(
      <RequireRole min="ADMIN" redirectTo="/dashboard">
        <p>secret admin content</p>
      </RequireRole>
    );
    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('does not redirect authorized users', () => {
    setAuth({ id: '1', role: 'ADMIN' });
    render(
      <RequireRole min="ADMIN" redirectTo="/dashboard">
        <p>ok</p>
      </RequireRole>
    );
    expect(replace).not.toHaveBeenCalled();
  });
});
