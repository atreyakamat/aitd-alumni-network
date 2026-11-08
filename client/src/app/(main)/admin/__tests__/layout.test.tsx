import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));

const authState: { user: any; isLoading: boolean } = { user: null, isLoading: false };
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

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
    expect(container).toBeEmptyDOMElement();
  });

  it.each(['ADMIN', 'SUPER_ADMIN'])('renders the admin UI for %s', (role) => {
    authState.user = { id: 'u', role, userRole: role };
    renderAdmin();
    expect(screen.getByText('admin console')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('does not render or redirect while the session is still loading', () => {
    authState.isLoading = true;
    renderAdmin();
    expect(screen.queryByText('admin console')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
