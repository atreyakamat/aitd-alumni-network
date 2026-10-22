import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const getStats = vi.fn();

vi.mock('@/lib/api', () => ({
  adminApi: { getStats: (...args: unknown[]) => getStats(...args) },
  getApiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

// Recharts needs real layout; render chart containers as plain divs
vi.mock('recharts', async () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    LineChart: Stub,
    Line: () => null,
    AreaChart: Stub,
    Area: () => null,
    BarChart: Stub,
    Bar: Stub,
    PieChart: Stub,
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
    verified: 80,
    growthPercent: 25,
    byRole: [],
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
    expect(screen.getByText('25%')).toBeInTheDocument(); // users
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
});
