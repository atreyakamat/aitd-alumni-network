import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getStats = vi.fn();

vi.mock('@/lib/api', () => ({
  adminApi: { getStats: (...args: unknown[]) => getStats(...args) },
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

// Recharts needs real layout; render chart containers as plain divs
vi.mock('recharts', async () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Chart = () => <div />;
  return {
    ResponsiveContainer: Stub,
    LineChart: Chart,
    Line: () => null,
    AreaChart: Chart,
    Area: () => null,
    BarChart: Chart,
    Bar: Stub,
    PieChart: Chart,
    Pie: Stub,
    Cell: () => null,
    XAxis: () => null,
    YAxis: () => null,
    CartesianGrid: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

import AdminAnalyticsPage from '../page';

const stats = {
  users: {
    total: 120,
    active: 64,
    verified: 80,
    newThisMonth: 9,
    growthPercent: 25,
    pendingApproval: 4,
    rejected: 2,
    byRole: [
      { role: 'MEMBER', count: 118 },
      { role: 'SUPER_ADMIN', count: 2 },
    ],
    byBatch: [],
    byLocation: [{ city: 'Pune', count: 12 }],
    monthlyGrowth: [],
  },
  content: {
    posts: { total: 10, thisMonth: 2 },
    comments: { total: 33, thisMonth: 4 },
    jobs: { total: 9, active: 5, newThisMonth: 3 },
    events: { total: 6, upcoming: 2, newThisMonth: 1 },
  },
  financial: {
    donations: { totalAmount: 5000, totalCount: 4, thisMonth: 300, lastMonth: 200, growthPercent: 50, thisYear: 900, monthly: [] },
    memberships: { total: 3, active: 2 },
  },
  engagement: {
    connections: 7,
    messages: { total: 40, thisMonth: 5 },
    daily: [],
  },
  recentActivity: { users: [], posts: [] },
};

describe('Admin analytics page', () => {
  beforeEach(() => {
    getStats.mockReset();
  });

  it('shows growth as a percentage and new jobs/events as counts', async () => {
    getStats.mockResolvedValue({ data: { data: stats } });
    render(<AdminAnalyticsPage />);

    expect(await screen.findByText('Total Donations')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument(); // members
    expect(screen.getByText('50%')).toBeInTheDocument(); // donations
    // Jobs (+3) and events (+1) are counts, never rendered as percentages
    expect(screen.queryByText('3%')).not.toBeInTheDocument();
    expect(screen.queryByText('1%')).not.toBeInTheDocument();
    expect(screen.getAllByText('new this month')).toHaveLength(2);
  });

  it('shows an error with a working retry instead of spinning forever', async () => {
    getStats.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { data: stats } });
    render(<AdminAnalyticsPage />);

    expect(await screen.findByText('Failed to load analytics')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Total Donations')).toBeInTheDocument();
    expect(getStats).toHaveBeenCalledTimes(2);
  });

  it('keeps its title while loading, in the shared page header, with no page-sized wrapper of its own', async () => {
    getStats.mockReturnValue(new Promise(() => {}));
    const { container } = render(<AdminAnalyticsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Analytics Dashboard' })).toBeInTheDocument();
    expect(screen.getByLabelText('Loading analytics')).toBeInTheDocument();
    expect(container.querySelector('.min-h-screen, .bg-slate-50, .p-6')).toBeNull();
  });

  it('calls approved members "Members" and not "Total Users"', async () => {
    getStats.mockResolvedValue({ data: { data: stats } });
    render(<AdminAnalyticsPage />);
    await screen.findByText('Total Donations');
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('new members vs last month')).toBeInTheDocument();
    expect(screen.queryByText('Total Users')).not.toBeInTheDocument();
  });

  describe('Platform Activity Summary has only real numbers', () => {
    const summary = async () => {
      getStats.mockResolvedValue({ data: { data: stats } });
      render(<AdminAnalyticsPage />);
      await screen.findByText('Total Donations');
      return screen.getByRole('region', { name: 'Platform Activity Summary' });
    };

    it('has no made-up "Active Sessions" figure', async () => {
      const region = await summary();
      expect(within(region).queryByText('Active Sessions')).not.toBeInTheDocument();
      expect(within(region).queryByText('234')).not.toBeInTheDocument();
    });

    it('labels the monthly registrations figure for what it is, not "today"', async () => {
      const region = await summary();
      expect(within(region).queryByText('New Registrations Today')).not.toBeInTheDocument();
      const tile = within(region).getByText('New members this month').parentElement!;
      expect(within(tile).getByText('9')).toBeInTheDocument();
    });

    it('shows members who signed in during the last 30 days from the real "active" field', async () => {
      const region = await summary();
      const tile = within(region).getByText('Active members (last 30 days)').parentElement!;
      expect(within(tile).getByText('64')).toBeInTheDocument();
    });

    it('replaces "Verified Users" by the number of registrations awaiting approval, as a link', async () => {
      const region = await summary();
      expect(within(region).queryByText('Verified Users')).not.toBeInTheDocument();
      const link = within(region).getByRole('link', { name: /Awaiting approval/ });
      expect(link).toHaveAttribute('href', '/admin/approvals');
      expect(within(link).getByText('4')).toBeInTheDocument();
    });

    it('does not call itself real-time', async () => {
      await summary();
      expect(screen.queryByText(/real-time/i)).not.toBeInTheDocument();
    });
  });

  it('shows a calm empty state, not an empty axis, when there is no revenue', async () => {
    getStats.mockResolvedValue({ data: { data: stats } });
    render(<AdminAnalyticsPage />);
    expect(await screen.findByText('No donations yet')).toBeInTheDocument();
  });

  it('names roles for people in the roles legend', async () => {
    getStats.mockResolvedValue({ data: { data: stats } });
    render(<AdminAnalyticsPage />);
    await screen.findByText('Total Donations');
    const roles = screen.getByRole('list', { name: 'Roles' });
    expect(within(roles).getByText('Member')).toBeInTheDocument();
    expect(within(roles).getByText('Super Admin')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SUPER_ADMIN/);
  });

  it('copes with a response that lacks sections', async () => {
    getStats.mockResolvedValue({ data: { data: { users: { total: 1 } } } });
    render(<AdminAnalyticsPage />);
    expect(await screen.findByText('Total Donations')).toBeInTheDocument();
    expect(screen.getByText('No donations yet')).toBeInTheDocument();
  });
});
