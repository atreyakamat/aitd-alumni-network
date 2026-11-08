import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
const authState = vi.hoisted(() => ({ user: null as any, isLoading: false }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

import ProfileRedirectPage from '@/app/(main)/profile/page';

beforeEach(() => {
  replace.mockReset();
  authState.user = null;
  authState.isLoading = false;
});

describe('ProfileRedirectPage (/profile)', () => {
  it('renders skeleton while auth state is loading', () => {
    authState.isLoading = true;
    render(<ProfileRedirectPage />);
    expect(screen.getByTestId('profile-skeleton')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects signed-in user to their canonical profile', () => {
    authState.user = { id: 'user-123' };
    authState.isLoading = false;
    render(<ProfileRedirectPage />);
    expect(replace).toHaveBeenCalledWith('/profile/user-123');
  });

  it('redirects unauthenticated user to login with redirect param', () => {
    authState.user = null;
    authState.isLoading = false;
    render(<ProfileRedirectPage />);
    expect(replace).toHaveBeenCalledWith('/login?redirect=/profile');
  });
});
