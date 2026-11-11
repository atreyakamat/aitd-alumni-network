import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getStats = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  adminApi: { getStats },
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'admin1', role: 'ADMIN', userRole: 'ADMIN' }, isLoading: false }) }));
vi.mock('@/components/admin/MentorshipOverviewCard', () => ({ MentorshipOverviewCard: () => <div>mentorship card</div> }));
vi.mock('@/components/admin/ExportPanel', () => ({ ExportPanel: () => <div id="data-exports">export panel</div> }));

// Recharts needs real layout; render the chart containers as plain divs
vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    LineChart: () => <div data-testid="line-chart" />,
    Line: () => null,
    AreaChart: () => <div data-testid="area-chart" />,
    Area: () => null,
    BarChart: () => <div data-testid="bar-chart" />,
    Bar: Stub,
    PieChart: () => <div data-testid="pie-chart" />,
    Pie: Stub,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

import AdminOverview from '@/app/(main)/admin/AdminOverview';

const stats = (over: Record<string, any> = {}) => ({
  users: {
    total: 26,
    active: 20,
    verified: 26,
    newThisMonth: 8,
    growthPercent: -26.7,
    pendingApproval: 3,
    rejected: 1,
    byRole: [
      { role: 'MEMBER', count: 22 },
      { role: 'CHAPTER_ADMIN', count: 1 },
      { role: 'ADMIN', count: 2 },
      { role: 'SUPER_ADMIN', count: 1 },
    ],
    byBatch: [{ year: 2019, count: 4 }],
    byLocation: [],
    monthlyGrowth: [{ month: 'Oct 26', count: 11 }, { month: 'Nov 26', count: 8 }],
    ...(over.users ?? {}),
  },
  content: {
    posts: { total: 10, thisMonth: 2 },
    comments: { total: 33, thisMonth: 4 },
    jobs: { total: 9, active: 5, newThisMonth: 3 },
    events: { total: 6, upcoming: 1, newThisMonth: 1 },
    ...(over.content ?? {}),
  },
  financial: {
    donations: { totalAmount: 0, totalCount: 0, thisMonth: 0, lastMonth: 0, growthPercent: 0, thisYear: 0, monthly: [{ month: 'Oct 26', donations: 0, memberships: 0 }], ...(over.donations ?? {}) },
    memberships: { total: 0, active: 0 },
  },
  engagement: { connections: 7, messages: { total: 40, thisMonth: 5 }, daily: [] },
  recentActivity: {
    users: [
      { id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com', batchYear: 2019, createdAt: '2026-11-09T10:00:00.000Z', approvalStatus: 'PENDING' },
      { id: 'u2', fullName: 'Grace Hopper', email: 'grace@example.com', batchYear: 2018, createdAt: '2026-11-08T10:00:00.000Z', approvalStatus: 'APPROVED' },
      { id: 'u3', fullName: 'Alan Turing', email: 'alan@example.com', batchYear: 2017, createdAt: '2026-11-07T10:00:00.000Z', approvalStatus: 'REJECTED' },
    ],
    posts: [{ id: 'p1', author: 'Ada Lovelace', content: 'Hello alumni', likes: 2, comments: 1, createdAt: '2026-11-09T09:00:00.000Z' }],
    ...(over.recentActivity ?? {}),
  },
});

const load = async (over: Record<string, any> = {}) => {
  getStats.mockResolvedValue({ data: { data: stats(over) } });
  render(<AdminOverview />);
  await screen.findByText('Recent Registrations');
};

beforeEach(() => {
  getStats.mockReset();
});

describe('Admin overview: structure', () => {
  it('shows the title straight away, with a loading state under it', () => {
    getStats.mockReturnValue(new Promise(() => {}));
    render(<AdminOverview />);
    expect(screen.getByRole('heading', { level: 1, name: 'Admin Dashboard' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loading dashboard')).toBeInTheDocument();
  });

  it('shows a friendly error with a working retry', async () => {
    getStats.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { data: stats() } });
    render(<AdminOverview />);
    expect(await screen.findByText('Failed to load dashboard statistics')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Recent Registrations')).toBeInTheDocument();
    expect(getStats).toHaveBeenCalledTimes(2);
  });

  it('links to System status instead of the old Control Center', async () => {
    await load();
    expect(screen.getByRole('link', { name: 'System status' })).toHaveAttribute('href', '/admin/status');
    expect(screen.queryByText(/control center/i)).not.toBeInTheDocument();
  });

  it('has a single h1 and no back link of its own', async () => {
    await load();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /back to admin|admin dashboard/i })).not.toBeInTheDocument();
  });

  it('does not crash on a response without most of its sections', async () => {
    getStats.mockResolvedValue({ data: { data: { users: { total: 3 } } } });
    render(<AdminOverview />);
    expect(await screen.findByText('Recent Registrations')).toBeInTheDocument();
    expect(screen.getByText('No registrations yet.')).toBeInTheDocument();
  });
});

describe('Admin overview: members and approvals', () => {
  it('calls the headline figure "Members", not "Total Users", and drops the meaningless "Verified Users" tile', async () => {
    await load();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.queryByText('Total Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Verified Users')).not.toBeInTheDocument();
    expect(screen.queryByText(/of total/)).not.toBeInTheDocument();
  });

  it('gives the growth badge its context and a calm colour when the number is negative', async () => {
    await load();
    const badge = screen.getByLabelText(/Down 26\.7% vs last month/);
    expect(badge).toBeInTheDocument();
    expect(badge.className).not.toMatch(/red|destructive/);
    expect(screen.getByText('8 new members this month')).toBeInTheDocument();
  });

  it('shows how many registrations await approval, as a link to the approvals page, highlighted when there are some', async () => {
    await load();
    const tile = screen.getByRole('link', { name: /Awaiting approval/ });
    expect(tile).toHaveAttribute('href', '/admin/approvals');
    expect(within(tile).getByText('3')).toBeInTheDocument();
    expect(tile.className).toMatch(/amber/);
  });

  it('is calm when nobody is waiting', async () => {
    await load({ users: { pendingApproval: 0 } });
    const tile = screen.getByRole('link', { name: /Awaiting approval/ });
    expect(within(tile).getByText('0')).toBeInTheDocument();
    expect(tile.className).not.toMatch(/amber/);
    expect(within(tile).getByText('Nobody is waiting')).toBeInTheDocument();
  });

  it('uses the right singular and plural: "1 upcoming event", "2 upcoming events"', async () => {
    await load();
    expect(screen.getByText('1 upcoming event')).toBeInTheDocument();
    expect(screen.queryByText(/1 upcoming events/)).not.toBeInTheDocument();
  });

  it('pluralises the other way too', async () => {
    await load({ content: { events: { total: 6, upcoming: 2, newThisMonth: 1 } } });
    expect(screen.getByText('2 upcoming events')).toBeInTheDocument();
  });

  it('writes "1 new member" in the singular', async () => {
    await load({ users: { newThisMonth: 1 } });
    expect(screen.getByText('1 new member this month')).toBeInTheDocument();
  });
});

describe('Admin overview: recent registrations', () => {
  it('shows each person with their status, and a Review link only for the pending ones', async () => {
    await load();
    const rows = screen.getAllByRole('listitem').filter((li) => /@example\.com/.test(li.textContent ?? ''));
    expect(rows).toHaveLength(3);

    expect(within(rows[0]).getByText('Pending approval')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Approved')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Rejected')).toBeInTheDocument();

    const review = within(rows[0]).getByRole('link', { name: /Review/ });
    expect(review).toHaveAttribute('href', '/admin/approvals?search=ada%40example.com');
    expect(within(rows[1]).queryByRole('link', { name: /Review/ })).not.toBeInTheDocument();
    expect(within(rows[2]).queryByRole('link', { name: /Review/ })).not.toBeInTheDocument();
  });

  it('prints dates as "9 Nov 2026", not the ambiguous 11/9/2026', async () => {
    await load();
    expect(screen.getAllByText('9 Nov 2026').length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
  });

  it('shows no status for an older server that does not send one', async () => {
    await load({ recentActivity: { users: [{ id: 'u1', fullName: 'Ada Lovelace', email: 'ada@example.com', batchYear: 2019, createdAt: '2026-11-09T10:00:00.000Z' }] } });
    expect(screen.queryByText('Pending approval')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Review registration of/ })).not.toBeInTheDocument();
  });
});

describe('Admin overview: charts', () => {
  it('shows a calm empty state for the revenue chart when there has been no money', async () => {
    await load();
    expect(screen.getByText('No donations yet')).toBeInTheDocument();
  });

  it('names roles for people, and never prints the raw enum', async () => {
    await load();
    const roles = screen.getByRole('list', { name: 'Roles' });
    expect(within(roles).getByText('Super Admin')).toBeInTheDocument();
    expect(within(roles).getByText('Member')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SUPER_ADMIN|CHAPTER_ADMIN/);
  });

  it('refreshes on request', async () => {
    await load();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh data' }));
    await waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));
  });
});
