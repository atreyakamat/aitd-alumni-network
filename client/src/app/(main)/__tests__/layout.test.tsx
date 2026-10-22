import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
let pathname = '/events';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
}));

const authState: { user: any; isLoading: boolean; isAuthenticated: boolean } = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
};
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

vi.mock('@/components/layout/MainNav', () => ({ MainNav: () => <nav data-testid="main-nav" /> }));
vi.mock('@/components/layout/ChatDrawer', () => ({ ChatDrawer: () => <div data-testid="chat-drawer" /> }));

import MainLayout from '@/app/(main)/layout';

const setAuth = (user: any, isLoading = false) => {
  authState.user = user;
  authState.isLoading = isLoading;
  authState.isAuthenticated = !!user;
};

const setLocation = (path: string) => {
  pathname = path.split('?')[0];
  window.history.replaceState({}, '', path);
};

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  setAuth(null);
  setLocation('/events');
});

describe('(main) layout gating', () => {
  it('renders public pages for anonymous visitors with the public header', () => {
    setLocation('/events');
    render(
      <MainLayout>
        <p>events list</p>
      </MainLayout>
    );
    expect(screen.getByText('events list')).toBeInTheDocument();
    expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-drawer')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /sign in/i })[0]).toHaveAttribute(
      'href',
      '/login?next=%2Fevents'
    );
    expect(screen.getAllByRole('link', { name: /join/i })[0]).toHaveAttribute('href', '/register?next=%2Fevents');
    for (const label of ['Events', 'Gallery', 'News', 'Donate', 'Chapters']) {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    }
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('allows nested public paths such as an event detail page', () => {
    setLocation('/events/42');
    render(
      <MainLayout>
        <p>event detail</p>
      </MainLayout>
    );
    expect(screen.getByText('event detail')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects anonymous visitors on private pages to login with a return path', () => {
    setLocation('/directory?batch=2020');
    render(
      <MainLayout>
        <p>directory</p>
      </MainLayout>
    );
    expect(screen.queryByText('directory')).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith('/login?next=%2Fdirectory%3Fbatch%3D2020');
  });

  it('does not redirect while auth is still loading', () => {
    setAuth(null, true);
    setLocation('/directory');
    render(
      <MainLayout>
        <p>directory</p>
      </MainLayout>
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('directory')).not.toBeInTheDocument();
  });

  it('renders the member shell for authenticated users', () => {
    setAuth({ id: 'u1', fullName: 'Ada' });
    setLocation('/events');
    render(
      <MainLayout>
        <p>events list</p>
      </MainLayout>
    );
    expect(screen.getByText('events list')).toBeInTheDocument();
    expect(screen.getByTestId('main-nav')).toBeInTheDocument();
    expect(screen.getByTestId('chat-drawer')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
  });
});
