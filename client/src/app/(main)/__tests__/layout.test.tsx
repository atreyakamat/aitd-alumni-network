import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const push = vi.fn();
const replace = vi.fn();
let pathname = '/events';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

const authState: { user: any; isLoading: boolean; isAuthenticated: boolean; clearSession: () => void } = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
  clearSession: vi.fn(),
};
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

vi.mock('@/components/layout/MainNav', () => ({ MainNav: () => <nav data-testid="main-nav" /> }));
vi.mock('@/components/layout/ChatDrawer', () => ({ ChatDrawer: () => <div data-testid="chat-drawer" /> }));

import MainLayout from '@/app/(main)/layout';
import { isMemberOnlyPath } from '@/lib/public-paths';

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
  vi.mocked(authState.clearSession).mockReset();
  setAuth(null);
  setLocation('/events');
});

describe('(main) layout gating', () => {
  it.each(['/events', '/events/42', '/gallery', '/news', '/chapters', '/posts/123', '/search?q=x', '/donationsx', '/admin/donations'])(
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

  it.each(['/donations', '/donations?amount=500', '/donations/thanks'])(
    'lets a visitor see %s (the guest donation page) in the public shell, without redirecting',
    (path) => {
      setLocation(path);
      render(
        <MainLayout>
          <p>donation form</p>
        </MainLayout>
      );
      expect(screen.getByText('donation form')).toBeInTheDocument();
      // the public header, not the member shell
      expect(screen.queryByTestId('main-nav')).not.toBeInTheDocument();
      expect(screen.queryByTestId('chat-drawer')).not.toBeInTheDocument();
      const here = encodeURIComponent(path.split('?')[0]);
      expect(screen.getAllByRole('link', { name: /sign in/i })[0]).toHaveAttribute('href', `/login?next=${here}`);
      expect(screen.getByRole('link', { name: /join now/i })).toHaveAttribute('href', `/register?next=${here}`);
      expect(replace).not.toHaveBeenCalled();
      expect(push).not.toHaveBeenCalled();
    }
  );

  it('the visitor shell links to no members-only page (everything it offers is open or goes through login)', () => {
    setLocation('/donations');
    const { container } = render(
      <MainLayout>
        <p>donation form</p>
      </MainLayout>
    );
    const offenders = Array.from(container.querySelectorAll('a[href]'))
      .map((a) => a.getAttribute('href') as string)
      .filter((href) => href.startsWith('/') && isMemberOnlyPath(href.split(/[?#]/)[0]));
    expect(offenders).toEqual([]);
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

  it('does not render the guest donation page before auth has settled', () => {
    setAuth(null, true);
    setLocation('/donations');
    render(
      <MainLayout>
        <p>donation form</p>
      </MainLayout>
    );
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('donation form')).not.toBeInTheDocument();
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

  it('gives a signed-in member the full member shell on /donations too (no public header)', () => {
    setAuth({ id: 'u1', fullName: 'Ada' });
    setLocation('/donations');
    render(
      <MainLayout>
        <p>donations</p>
      </MainLayout>
    );
    expect(screen.getByText('donations')).toBeInTheDocument();
    expect(screen.getByTestId('main-nav')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign in/i })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('(main) layout: a session that ends while the guest donation page is open', () => {
  const sessionEnds = (event: 'api:session_expired' | 'api:account_not_approved') => {
    act(() => {
      window.dispatchEvent(new CustomEvent(event, { detail: {} }));
    });
  };

  it.each(['api:session_expired', 'api:account_not_approved'] as const)(
    'drops the member to the visitor view on %s: the page re-renders as a visitor instead of a stale signed-in member',
    (event) => {
      setAuth({ id: 'u1', fullName: 'Ada' });
      setLocation('/donations');
      render(
        <MainLayout>
          <p>donations</p>
        </MainLayout>
      );
      sessionEnds(event);
      expect(authState.clearSession).toHaveBeenCalledTimes(1);
      // api.ts does not move an open visitor page, and neither does the layout
      expect(replace).not.toHaveBeenCalled();
    }
  );

  it('does nothing on a members-only page: there api.ts takes the person to the login page itself', () => {
    setAuth({ id: 'u1', fullName: 'Ada' });
    setLocation('/events');
    render(
      <MainLayout>
        <p>events</p>
      </MainLayout>
    );
    sessionEnds('api:session_expired');
    expect(authState.clearSession).not.toHaveBeenCalled();
  });

  it('stops listening when the layout unmounts', () => {
    setAuth({ id: 'u1', fullName: 'Ada' });
    setLocation('/donations');
    const { unmount } = render(
      <MainLayout>
        <p>donations</p>
      </MainLayout>
    );
    unmount();
    sessionEnds('api:session_expired');
    expect(authState.clearSession).not.toHaveBeenCalled();
  });
});
