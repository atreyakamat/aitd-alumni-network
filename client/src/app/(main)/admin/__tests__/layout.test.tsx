import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }), usePathname: () => '/admin/users' }));

const authState: { user: any; isLoading: boolean } = { user: null, isLoading: false };
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/use-pending-approvals', () => ({ usePendingApprovals: () => 2 }));

import AdminLayout from '@/app/(main)/admin/layout';

const renderAdmin = () =>
  render(
    <AdminLayout>
      <p>admin console</p>
    </AdminLayout>
  );

beforeEach(() => {
  replace.mockReset();
  authState.user = null;
  authState.isLoading = false;
});

describe('/admin layout gate', () => {
  it.each(['MEMBER', 'CHAPTER_ADMIN'])('redirects a %s to /dashboard and renders nothing', (role) => {
    authState.user = { id: 'u', role, userRole: role };
    const { container } = renderAdmin();
    expect(replace).toHaveBeenCalledWith('/dashboard');
    expect(screen.queryByText('admin console')).not.toBeInTheDocument();
    expect(screen.queryByText(/access denied/i)).not.toBeInTheDocument();
    // not even the navigation: nothing of the admin UI is shown to somebody who may not use it
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['ADMIN', 'SUPER_ADMIN'])('renders the admin UI for %s', (role) => {
    authState.user = { id: 'u', role, userRole: role };
    renderAdmin();
    expect(screen.getByText('admin console')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('puts the section navigation above the page for an administrator', () => {
    authState.user = { id: 'u', role: 'ADMIN', userRole: 'ADMIN' };
    renderAdmin();
    const nav = screen.getByRole('navigation', { name: 'Admin sections' });
    const page = screen.getByText('admin console');
    // the nav comes first in the document, then the page content
    expect(nav.compareDocumentPosition(page) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
  });

  it('gives every admin page the same content width', () => {
    authState.user = { id: 'u', role: 'ADMIN', userRole: 'ADMIN' };
    const { container } = renderAdmin();
    expect(container.firstElementChild).toHaveClass('max-w-7xl', 'mx-auto', 'w-full');
  });

  it('does not render or redirect while the session is still loading', () => {
    authState.isLoading = true;
    renderAdmin();
    expect(screen.queryByText('admin console')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin sections' })).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
