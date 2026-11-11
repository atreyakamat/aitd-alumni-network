/**
 * Links from other admin pages open the approvals page on the right tab, already filtered to one person:
 * /admin/approvals?search=<e-mail> (dashboard "Review", members list "Review application") and
 * /admin/approvals?status=REJECTED&search=<e-mail> for somebody who was turned down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let params = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/approvals',
  useSearchParams: () => params,
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const adminApi = vi.hoisted(() => ({ listApprovals: vi.fn(), approvalSummary: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), adminApi }));

import ApprovalsPage from '@/app/(main)/admin/approvals/page';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ApprovalsPage />
    </QueryClientProvider>
  );

const firstFilters = () => adminApi.listApprovals.mock.calls[0][0];

beforeEach(() => {
  params = new URLSearchParams();
  adminApi.listApprovals.mockReset().mockResolvedValue({ data: { success: true, data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
  adminApi.approvalSummary.mockReset().mockResolvedValue({ data: { success: true, data: { pending: 1, approved: 2, rejected: 3 } } });
});

describe('/admin/approvals deep links', () => {
  it('opens the Pending tab with no filter by default', async () => {
    renderPage();
    await screen.findByText('No registrations are waiting for approval.');
    expect(firstFilters()).toMatchObject({ status: 'PENDING', page: 1 });
    expect(firstFilters().search).toBeUndefined();
    expect(screen.getByRole('tab', { name: /Pending/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('filters to one person by ?search=<e-mail> and shows what was searched for', async () => {
    params = new URLSearchParams('search=ada%40example.com');
    renderPage();
    await screen.findByText('No registrations match this search');
    expect(firstFilters()).toMatchObject({ status: 'PENDING', search: 'ada@example.com' });
    expect(screen.getByRole('searchbox', { name: 'Search registrations' })).toHaveValue('ada@example.com');
  });

  it('opens the Rejected tab for ?status=REJECTED', async () => {
    params = new URLSearchParams('status=REJECTED&search=rae%2Btest%40example.com');
    renderPage();
    await screen.findByText('No registrations match this search');
    expect(firstFilters()).toMatchObject({ status: 'REJECTED', search: 'rae+test@example.com' });
    expect(screen.getByRole('tab', { name: /Rejected/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores a status it does not know', async () => {
    params = new URLSearchParams('status=EVERYTHING');
    renderPage();
    await screen.findByText('No registrations are waiting for approval.');
    expect(firstFilters().status).toBe('PENDING');
  });

  it('starts with the shared header: one h1, no back link of its own', async () => {
    renderPage();
    await screen.findByText('No registrations are waiting for approval.');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Registration approvals');
    expect(screen.queryByRole('link', { name: /admin dashboard/i })).not.toBeInTheDocument();
  });
});
