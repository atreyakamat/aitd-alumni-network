import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

const authState: { user: any } = { user: null };
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: authState.user, logout: vi.fn() }) }));
vi.mock('@/components/notifications/NotificationBell', () => ({ NotificationBell: () => <button type="button">Notifications</button> }));

const approvalSummary = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, approvalSummary: (...args: unknown[]) => approvalSummary(...args) } };
});

import { MainNav, adminItems } from '@/components/layout/MainNav';

const admin = { id: 'a1', fullName: 'Admin One', email: 'admin@example.com', userRole: 'ADMIN', role: 'ADMIN' };
const member = { id: 'm1', fullName: 'Asha Rao', email: 'asha@example.com', userRole: 'MEMBER', role: 'MEMBER' };

beforeEach(() => {
  push.mockReset();
  approvalSummary.mockReset().mockResolvedValue({ data: { success: true, data: { pending: 4, approved: 10, rejected: 1 } } });
  authState.user = admin;
});

describe('the Approvals entry of the admin navigation', () => {
  it('is listed among the admin items, right after the dashboard', () => {
    const hrefs = adminItems.map((i) => i.href);
    expect(hrefs).toContain('/admin/approvals');
    expect(hrefs.indexOf('/admin/approvals')).toBe(1);
    expect(adminItems.find((i) => i.href === '/admin/approvals')?.label).toBe('Approvals');
  });

  it('shows the number of registrations that wait on the Admin button', async () => {
    render(<MainNav />);
    expect(await screen.findByLabelText('4 registrations waiting for approval')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute('href', '/admin');
  });

  it('shows it beside "Approvals" in the mobile menu, which links to the page', async () => {
    render(<MainNav />);
    await screen.findByLabelText('4 registrations waiting for approval');
    await userEvent.click(screen.getByRole('button', { name: /open menu/i }));

    const link = screen.getByRole('link', { name: /approvals/i });
    expect(link).toHaveAttribute('href', '/admin/approvals');
    expect(within(link).getByText('4')).toBeInTheDocument();
  });

  it('shows it in the "More" menu too, and opens the page', async () => {
    render(<MainNav />);
    await screen.findByLabelText('4 registrations waiting for approval');
    await userEvent.click(screen.getByRole('button', { name: /more/i }));
    const item = await screen.findByRole('menuitem', { name: /approvals/i });
    expect(within(item).getByText('4')).toBeInTheDocument();
    await userEvent.click(item);
    expect(push).toHaveBeenCalledWith('/admin/approvals');
  });

  it('shows no badge when nothing waits', async () => {
    approvalSummary.mockResolvedValue({ data: { success: true, data: { pending: 0, approved: 10, rejected: 1 } } });
    render(<MainNav />);
    await waitFor(() => expect(approvalSummary).toHaveBeenCalled());
    expect(screen.queryByLabelText(/waiting for approval/i)).not.toBeInTheDocument();
  });

  it('must not break the navigation when the call fails: the entry stays, only the badge is missing', async () => {
    approvalSummary.mockRejectedValue(new Error('Network Error'));
    render(<MainNav />);
    await waitFor(() => expect(approvalSummary).toHaveBeenCalled());
    expect(screen.queryByLabelText(/waiting for approval/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('link', { name: /approvals/i })).toHaveAttribute('href', '/admin/approvals');
  });

  it('is not shown to a member, who also never triggers the call', async () => {
    authState.user = member;
    render(<MainNav />);
    await userEvent.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();
    expect(approvalSummary).not.toHaveBeenCalled();
  });
});
