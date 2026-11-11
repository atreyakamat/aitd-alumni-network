import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/audit',
  useSearchParams: () => search,
}));

let authUser: { id: string; userRole: string } = { id: 'admin-1', userRole: 'ADMIN' };
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: authUser, isAuthenticated: true }) }));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const adminApi = vi.hoisted(() => ({
  getAuditLogs: vi.fn(),
  cleanupAuditLogs: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    adminApi,
    getApiErrorMessage: (_err: unknown, fallback: string) => `friendly: ${fallback}`,
  };
});

import AdminAuditPage from '@/app/(main)/admin/audit/page';

const entry = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  user: { id: 'u1', fullName: 'Ada Admin', email: 'ada@aiem.test' },
  action: 'ROLE_CHANGE',
  entityType: 'USER',
  entityId: `target-${id}`,
  oldValues: { role: 'MEMBER' },
  newValues: { role: 'ADMIN' },
  ipAddress: '10.0.0.1',
  userAgent: 'jest',
  createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  ...extra,
});

const pageOf = (logs: unknown[], page = 1, totalPages = 1) => ({
  data: { success: true, logs, pagination: { page, limit: 25, total: logs.length, totalPages } },
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminAuditPage />
    </QueryClientProvider>
  );
};

const lastParams = () => adminApi.getAuditLogs.mock.calls.at(-1)?.[0];

beforeEach(() => {
  search = new URLSearchParams();
  authUser = { id: 'admin-1', userRole: 'ADMIN' };
  toast.mockReset();
  adminApi.getAuditLogs.mockReset().mockResolvedValue(pageOf([entry('1')]));
  adminApi.cleanupAuditLogs.mockReset();
});

describe('Admin audit log page', () => {
  it('renders entries with actor, action, entity and IP', async () => {
    renderPage();

    const row = (await screen.findByText('Ada Admin')).closest('tr')!;
    expect(within(row).getByText('ada@aiem.test')).toBeInTheDocument();
    expect(within(row).getByText('ROLE_CHANGE')).toBeInTheDocument();
    expect(within(row).getByText('USER')).toBeInTheDocument();
    expect(within(row).getByText('target-1')).toBeInTheDocument();
    expect(within(row).getByText('10.0.0.1')).toBeInTheDocument();
    expect(within(row).getByText(/2 hours ago/)).toBeInTheDocument();
    expect(lastParams()).toMatchObject({ page: 1 });
  });

  it('starts with the shared page header: one h1, no back link of its own', async () => {
    renderPage();
    await screen.findByText('Ada Admin');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Audit log');
    expect(screen.queryByRole('link', { name: /admin dashboard/i })).not.toBeInTheDocument();
  });

  describe('Entity column', () => {
    const UUID = '3f2b8c1e-5d4a-4c1b-9a7e-0f6d2b1c8a90';

    it('shows who it was done to when the server sends a label, with the entity type as a small caption', async () => {
      adminApi.getAuditLogs.mockResolvedValue(pageOf([entry('1', { entityId: UUID, entityLabel: 'Jane Doe (jane@x.edu)' })]));
      renderPage();

      const row = (await screen.findByText('Jane Doe (jane@x.edu)')).closest('tr')!;
      const caption = within(row).getByText('USER');
      expect(caption.className).toMatch(/text-xs/);
      expect(caption.className).toMatch(/muted/);
      // the raw id is not what the administrator reads
      expect(row.textContent).not.toContain(UUID);
      expect(row.textContent).not.toContain('3f2b8c1e');
    });

    it('shortens a bare id and keeps the full id in a title when there is no label', async () => {
      adminApi.getAuditLogs.mockResolvedValue(pageOf([entry('1', { entityId: UUID, entityLabel: null })]));
      renderPage();

      const short = await screen.findByText('3f2b8c1e…');
      expect(short).toHaveAttribute('title', UUID);
      expect(within(short.closest('tr')!).getByText('USER')).toBeInTheDocument();
      expect(short.closest('tr')!.textContent).not.toContain(UUID);
    });

    it('also copes with a server that has no entityLabel at all', async () => {
      adminApi.getAuditLogs.mockResolvedValue(pageOf([entry('1', { entityId: UUID })]));
      renderPage();
      expect(await screen.findByText('3f2b8c1e…')).toHaveAttribute('title', UUID);
    });

    it('leaves a short id as it is', async () => {
      renderPage();
      expect(await screen.findByText('target-1')).toHaveAttribute('title', 'target-1');
    });

    it('shows nothing under the type for an entry without an entity id or label', async () => {
      adminApi.getAuditLogs.mockResolvedValue(pageOf([entry('1', { entityType: 'SYSTEM', entityId: null })]));
      renderPage();
      const table = await screen.findByRole('table');
      const row = within(table).getByText('SYSTEM').closest('tr')!;
      expect(row.querySelector('[title]')).toBeNull();
    });

    it('still gives the full entity id in the expanded details', async () => {
      adminApi.getAuditLogs.mockResolvedValue(pageOf([entry('1', { entityId: UUID, entityLabel: 'Jane Doe (jane@x.edu)' })]));
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: /show details/i }));
      expect(within(screen.getByTestId('audit-details-1')).getByText(UUID)).toBeInTheDocument();
    });

    it('treats a label as plain text, never as HTML', async () => {
      adminApi.getAuditLogs.mockResolvedValue(pageOf([entry('1', { entityLabel: '<img src=x onerror=alert(1)> (a@b.c)' })]));
      const { container } = renderPage();
      expect(await screen.findByText(/<img src=x/)).toBeInTheDocument();
      expect(container.querySelector('img')).toBeNull();
    });
  });

  it('falls back to the user id, or "System", when no actor is resolved', async () => {
    adminApi.getAuditLogs.mockResolvedValue(
      pageOf([entry('1', { user: null, userId: 'deleted-user-9' }), entry('2', { user: null, userId: null })])
    );
    renderPage();
    expect(await screen.findByText('deleted-user-9')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('expands a row to show old/new values as plain text JSON', async () => {
    adminApi.getAuditLogs.mockResolvedValue(
      pageOf([entry('1', { newValues: { bio: '<img src=x onerror="alert(1)">' } })])
    );
    const { container } = renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /show details/i }));

    const details = screen.getByTestId('audit-details-1');
    expect(within(details).getByText(/"role": "MEMBER"/)).toBeInTheDocument();
    expect(within(details).getByText(/onerror=/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('highlights security alerts and payment mismatches', async () => {
    adminApi.getAuditLogs.mockResolvedValue(
      pageOf([
        entry('1', { action: 'SECURITY_ALERT' }),
        entry('2', { action: 'PAYMENT_MISMATCH', entityType: 'TRANSACTION' }),
        entry('3', { action: 'LOGIN' }),
      ])
    );
    renderPage();

    const rowFor = async (action: string) => (await screen.findByText(action, { selector: '[data-audit-action]' })).closest('tr')!;
    expect((await rowFor('SECURITY_ALERT')).dataset.severity).toBe('danger');
    expect((await rowFor('PAYMENT_MISMATCH')).dataset.severity).toBe('warning');
    expect((await rowFor('LOGIN')).dataset.severity).toBeUndefined();
  });

  it('sends filter changes to the API and resets to page 1', async () => {
    adminApi.getAuditLogs.mockResolvedValue(pageOf([entry('1')], 1, 3));
    renderPage();
    await screen.findByText('Ada Admin');

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }));

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by action' }));
    await userEvent.click(await screen.findByRole('option', { name: 'DELETE' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ action: 'DELETE', page: 1 }));

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by entity type' }));
    await userEvent.click(await screen.findByRole('option', { name: 'JOB' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ action: 'DELETE', entityType: 'JOB' }));

    await userEvent.type(screen.getByLabelText('Actor user id'), 'user-42');
    await waitFor(() => expect(lastParams()).toMatchObject({ userId: 'user-42' }));

    await userEvent.type(screen.getByLabelText('From date'), '2026-01-05');
    await userEvent.type(screen.getByLabelText('To date'), '2026-01-31');
    await waitFor(() => {
      const params = lastParams();
      expect(new Date(params.startDate).getTime()).toBe(new Date(2026, 0, 5, 0, 0, 0, 0).getTime());
      expect(new Date(params.endDate).getTime()).toBe(new Date(2026, 0, 31, 23, 59, 59, 999).getTime());
    });
  });

  it('quick filter chips toggle the action filter', async () => {
    renderPage();
    await screen.findByText('Ada Admin');

    const security = screen.getByRole('button', { name: 'Security alerts' });
    await userEvent.click(security);
    await waitFor(() => expect(lastParams()).toMatchObject({ action: 'SECURITY_ALERT' }));
    expect(security).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Payment mismatches' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ action: 'PAYMENT_MISMATCH' }));

    await userEvent.click(screen.getByRole('button', { name: 'Payment mismatches' }));
    await waitFor(() => expect(lastParams()?.action).toBeUndefined());
  });

  it('prefills filters from the URL (?action=PAYMENT_MISMATCH)', async () => {
    search = new URLSearchParams('action=PAYMENT_MISMATCH&entityType=TRANSACTION');
    renderPage();
    await screen.findByText('Ada Admin');
    expect(adminApi.getAuditLogs.mock.calls[0][0]).toMatchObject({
      action: 'PAYMENT_MISMATCH',
      entityType: 'TRANSACTION',
      page: 1,
    });
    expect(screen.getByRole('button', { name: 'Payment mismatches' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('ignores unknown actions in the URL', async () => {
    search = new URLSearchParams('action=DROP_TABLES');
    renderPage();
    await screen.findByText('Ada Admin');
    expect(adminApi.getAuditLogs.mock.calls[0][0].action).toBeUndefined();
  });

  it('shows an empty state', async () => {
    adminApi.getAuditLogs.mockResolvedValue(pageOf([]));
    renderPage();
    expect(await screen.findByText(/no audit entries/i)).toBeInTheDocument();
  });

  it('shows the API error and retries', async () => {
    adminApi.getAuditLogs.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByText(/friendly:/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Ada Admin')).toBeInTheDocument();
    expect(adminApi.getAuditLogs).toHaveBeenCalledTimes(2);
  });

  it('hides "Clean up old logs" from regular admins', async () => {
    renderPage();
    await screen.findByText('Ada Admin');
    expect(screen.queryByRole('button', { name: /clean up old logs/i })).not.toBeInTheDocument();
  });

  it('lets a super admin clean up old logs after confirming the retention', async () => {
    authUser = { id: 'super-1', userRole: 'SUPER_ADMIN' };
    adminApi.cleanupAuditLogs.mockResolvedValue({
      data: { success: true, message: 'Successfully deleted 7 old audit logs', deletedCount: 7 },
    });
    renderPage();
    await screen.findByText('Ada Admin');

    await userEvent.click(screen.getByRole('button', { name: /clean up old logs/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/365 days/)).toBeInTheDocument();
    expect(adminApi.cleanupAuditLogs).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: /delete old entries/i }));
    await waitFor(() => expect(adminApi.cleanupAuditLogs).toHaveBeenCalledWith(365));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringMatching(/7/) }))
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The list is refreshed after a cleanup.
    await waitFor(() => expect(adminApi.getAuditLogs.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it('toasts the API error when cleanup fails', async () => {
    authUser = { id: 'super-1', userRole: 'SUPER_ADMIN' };
    adminApi.cleanupAuditLogs.mockRejectedValue(new Error('nope'));
    renderPage();
    await screen.findByText('Ada Admin');

    await userEvent.click(screen.getByRole('button', { name: /clean up old logs/i }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /delete old entries/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: expect.stringMatching(/friendly:/) }))
    );
  });
});
