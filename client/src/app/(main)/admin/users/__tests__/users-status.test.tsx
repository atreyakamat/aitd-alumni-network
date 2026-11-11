/**
 * One status per person, and nothing offered that does not apply: a person who is waiting for approval (or was turned
 * down) is not an "active" member, so they get "Review application" instead of a role picker and Deactivate; and an
 * administrator cannot change their own role or status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin/users' }));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: { id: 'admin1', fullName: 'Admin One', role: 'SUPER_ADMIN', userRole: 'SUPER_ADMIN' } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { api } from '@/lib/api';
import AdminUsersPage from '@/app/(main)/admin/users/page';

const person = (over: Record<string, unknown>) => ({
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
  approvalStatus: 'APPROVED',
  lastLoginAt: null,
  createdAt: '2026-11-01T10:00:00.000Z',
  ...over,
});

const ROWS = [
  person({}),
  person({ id: 'u2', fullName: 'Pat Pending', email: 'pat@example.com', isVerified: false, approvalStatus: 'PENDING' }),
  person({ id: 'u3', fullName: 'Rae Rejected', email: 'rae+test@example.com', isVerified: false, approvalStatus: 'REJECTED', isActive: false }),
  person({ id: 'u4', fullName: 'Dee Deactivated', email: 'dee@example.com', isActive: false }),
  person({ id: 'admin1', fullName: 'Admin One', email: 'admin@example.com', userRole: 'SUPER_ADMIN' }),
];

let respond: (config: InternalAxiosRequestConfig) => Promise<unknown>;
let realAdapter: unknown;

beforeEach(() => {
  realAdapter = api.defaults.adapter;
  respond = async (config) => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
    data: { success: true, data: ROWS, pagination: { page: 1, limit: 20, total: ROWS.length, totalPages: 1 } },
  });
  api.defaults.adapter = ((config: InternalAxiosRequestConfig) => respond(config)) as unknown as AxiosAdapter;
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

const rowOf = async (name: string) => (await screen.findByText(name)).closest('tr') as HTMLElement;

describe('/admin/users: page frame', () => {
  it('starts with the shared header: one h1, no back link of its own', async () => {
    renderPage();
    await rowOf('Ada Lovelace');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('User management');
    expect(screen.queryByRole('link', { name: /admin dashboard/i })).not.toBeInTheDocument();
  });

  it('shows a friendly error with a Retry when the list cannot be loaded', async () => {
    respond = async (config) => {
      const response = { status: 500, statusText: 'Server Error', headers: {}, config, data: { success: false, error: { code: 'X', message: 'The database is down.' } } };
      throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response as any);
    };
    renderPage();
    expect(await screen.findByText('Could not load users')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('/admin/users: one clear status per person', () => {
  it('shows "Active" in green for an approved member', async () => {
    renderPage();
    const row = await rowOf('Ada Lovelace');
    const badge = within(row).getByText('Active');
    expect(badge.className).toMatch(/green/);
    expect(within(row).queryByText(/pending|rejected|deactivated|not approved/i)).not.toBeInTheDocument();
  });

  it('shows "Pending approval" in amber, and not "Active", for somebody waiting for a decision', async () => {
    renderPage();
    const row = await rowOf('Pat Pending');
    const badge = within(row).getByText('Pending approval');
    expect(badge.className).toMatch(/amber/);
    expect(within(row).queryByText('Active')).not.toBeInTheDocument();
    expect(within(row).queryByText('Not approved')).not.toBeInTheDocument();
  });

  it('shows "Rejected" in red for somebody who was turned down, even though their record is inactive', async () => {
    renderPage();
    const row = await rowOf('Rae Rejected');
    expect(within(row).getByText('Rejected').className).toMatch(/red/);
    expect(within(row).queryByText('Deactivated')).not.toBeInTheDocument();
  });

  it('shows "Deactivated" in grey for an approved member whose access was switched off', async () => {
    renderPage();
    const row = await rowOf('Dee Deactivated');
    expect(within(row).getByText('Deactivated').className).toMatch(/slate/);
    expect(within(row).queryByText('Active')).not.toBeInTheDocument();
  });

  it('shows exactly one status badge in every row', async () => {
    renderPage();
    for (const name of ['Ada Lovelace', 'Pat Pending', 'Rae Rejected', 'Dee Deactivated', 'Admin One']) {
      const row = await rowOf(name);
      const found = within(row).queryAllByText(/^(Active|Pending approval|Rejected|Deactivated|Not approved)$/);
      expect(found, name).toHaveLength(1);
    }
  });
});

describe('/admin/users: what can be done to whom', () => {
  it('offers a role picker and Deactivate for an approved member', async () => {
    renderPage();
    const row = await rowOf('Ada Lovelace');
    expect(within(row).getByRole('combobox', { name: 'Role for Ada Lovelace' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: /Deactivate/ })).toBeEnabled();
    expect(within(row).queryByRole('link', { name: 'Review application' })).not.toBeInTheDocument();
  });

  it('offers Reactivate, not Deactivate, for a deactivated member', async () => {
    renderPage();
    const row = await rowOf('Dee Deactivated');
    expect(within(row).getByRole('button', { name: /Reactivate/ })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^Deactivate/ })).not.toBeInTheDocument();
  });

  it('replaces the role picker and Deactivate by "Review application" for a pending applicant', async () => {
    renderPage();
    const row = await rowOf('Pat Pending');
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Deactivate|Reactivate/ })).not.toBeInTheDocument();
    const link = within(row).getByRole('link', { name: 'Review application' });
    expect(link).toHaveAttribute('href', '/admin/approvals?search=pat%40example.com');
  });

  it('opens the Rejected tab for a rejected applicant', async () => {
    renderPage();
    const row = await rowOf('Rae Rejected');
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /Deactivate|Reactivate/ })).not.toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Review application' })).toHaveAttribute(
      'href',
      '/admin/approvals?status=REJECTED&search=rae%2Btest%40example.com'
    );
  });

  it('keeps the person\'s role visible, read-only, for an applicant', async () => {
    renderPage();
    const row = await rowOf('Pat Pending');
    expect(within(row).getByText('Member')).toBeInTheDocument();
  });
});

describe('/admin/users: an administrator cannot change their own account', () => {
  it('disables the role picker, with the reason', async () => {
    renderPage();
    const row = await rowOf('Admin One');
    const select = within(row).getByRole('combobox', { name: 'Role for Admin One' });
    expect(select).toBeDisabled();
    expect(select).toHaveAttribute('title', "You can't change your own role");
  });

  it('disables Deactivate, with the reason, instead of hiding it behind a dash', async () => {
    renderPage();
    const row = await rowOf('Admin One');
    const button = within(row).getByRole('button', { name: /Deactivate/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', "You can't change your own status");
    await userEvent.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks the row as yours', async () => {
    renderPage();
    const row = await rowOf('Admin One');
    expect(within(row).getByText('(you)')).toBeInTheDocument();
  });

  it('still lets the administrator change somebody else', async () => {
    renderPage();
    const row = await rowOf('Ada Lovelace');
    await userEvent.click(within(row).getByRole('button', { name: /Deactivate/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
