import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const seen = vi.hoisted(() => ({
  yTick: undefined as undefined | ((v: number) => string),
  yDecimals: undefined as undefined | boolean,
  tooltip: undefined as undefined | ((v: number) => string),
  charts: 0,
}));

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    ResponsiveContainer: Stub,
    BarChart: (props: { children?: React.ReactNode }) => {
      seen.charts += 1;
      return <div data-testid="bar-chart">{props.children}</div>;
    },
    Bar: () => null,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: (props: { tickFormatter?: (v: number) => string; allowDecimals?: boolean }) => {
      seen.yTick = props.tickFormatter;
      seen.yDecimals = props.allowDecimals;
      return null;
    },
    Tooltip: (props: { formatter?: (v: number) => string }) => {
      seen.tooltip = props.formatter;
      return null;
    },
    Legend: () => null,
  };
});

import { RevenueChart } from '@/components/admin/RevenueChart';

beforeEach(() => {
  seen.yTick = undefined;
  seen.yDecimals = undefined;
  seen.tooltip = undefined;
  seen.charts = 0;
});

describe('<RevenueChart>', () => {
  it('shows a calm empty state instead of an empty axis when there has been no money at all', () => {
    render(<RevenueChart data={[{ month: 'Oct 26', donations: 0, memberships: 0 }, { month: 'Nov 26', donations: 0, memberships: 0 }]} />);
    expect(screen.getByText('No donations yet')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
    expect(seen.yTick).toBeUndefined();
  });

  it('shows the empty state when the server sent no months', () => {
    render(<RevenueChart data={[]} />);
    expect(screen.getByText('No donations yet')).toBeInTheDocument();
  });

  it('draws the chart as soon as one month has money', () => {
    render(<RevenueChart data={[{ month: 'Oct 26', donations: 0, memberships: 0 }, { month: 'Nov 26', donations: 1500, memberships: 0 }]} />);
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
    expect(screen.queryByText('No donations yet')).not.toBeInTheDocument();
  });

  it('labels the Y axis with compact rupees, never fractions of a thousand', () => {
    render(<RevenueChart data={[{ month: 'Nov 26', donations: 4, memberships: 0 }]} />);
    expect(seen.yTick).toBeTypeOf('function');
    expect(seen.yTick!(0)).toBe('₹0');
    expect(seen.yTick!(800)).toBe('₹800');
    expect(seen.yTick!(1500)).toBe('₹1.5K');
    expect(seen.yTick!(250000)).toBe('₹2.5L');
    expect(seen.yTick!(12000000)).toBe('₹1.2Cr');
    expect(seen.yTick!(0.004)).toBe('₹0');
    // no half-rupee ticks on a chart with tiny amounts
    expect(seen.yDecimals).toBe(false);
  });

  it('prints full rupees in the tooltip', () => {
    render(<RevenueChart data={[{ month: 'Nov 26', donations: 150000, memberships: 0 }]} />);
    expect(seen.tooltip!(150000)).toBe('₹1,50,000');
  });
});
