import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
let pathname = '/events';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
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
  it.each(['/events', '/events/42', '/gallery', '/news', '/donations', '/chapters', '/posts/123', '/search?q=x'])(
    'shows a visitor nothing of %s (the platform is private) and sends them to login with a return path',
    (path) => {
      setLocation(path);
      render(
        <MainLayout>
          <p>page content</p>
        </MainLayout>
      );
      expect(screen.queryByText('page content')).not.toBeInTheDocument();
      expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chat-drawer')).not.toBeInTheDocument();
      // no public header with navigation to browse around either
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(replace).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(path)}`);
    }
  );

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
