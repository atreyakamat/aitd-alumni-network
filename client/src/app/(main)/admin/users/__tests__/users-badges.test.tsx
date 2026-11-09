/**
 * `isVerified` on a user now means "approved member" (an administrator approved the registration), so the badge for a
 * user without it must not say "Unverified": that is about the e-mail address, which is a different thing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin/users' }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'admin1', role: 'SUPER_ADMIN', userRole: 'SUPER_ADMIN' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { api } from '@/lib/api';
import AdminUsersPage from '@/app/(main)/admin/users/page';

const user = (over: Record<string, unknown>) => ({
  id: 'u1',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  profilePhotoUrl: null,
  batchYear: 2019,
  department: 'Computer Science',
  roleType: 'ALUMNI',
  userRole: 'MEMBER',
  isActive: true,
  isVerified: true,
  lastLoginAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

let realAdapter: unknown;
beforeEach(() => {
  realAdapter = api.defaults.adapter;
  api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
    data: {
      success: true,
      data: [user({}), user({ id: 'u2', fullName: 'Not Yet Approved', email: 'nya@example.com', isVerified: false })],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    },
  })) as unknown as AxiosAdapter;
});
afterEach(() => {
  api.defaults.adapter = realAdapter as any;
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminUsersPage />
    </QueryClientProvider>
  );

describe('/admin/users status badges', () => {
  it('marks a user who is not an approved member as "Not approved", not "Unverified"', async () => {
    renderPage();
    const row = (await screen.findByText('Not Yet Approved')).closest('tr') as HTMLElement;
    expect(within(row).getByText('Not approved')).toBeInTheDocument();
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
  });

  it('shows no such badge for an approved member', async () => {
    renderPage();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr') as HTMLElement;
    expect(within(row).queryByText('Not approved')).not.toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });
});
