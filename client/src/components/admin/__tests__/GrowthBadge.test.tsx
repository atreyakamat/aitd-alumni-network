import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GrowthBadge } from '@/components/admin/GrowthBadge';

describe('<GrowthBadge>', () => {
  it('shows growth in green with an up arrow', () => {
    const { container } = render(<GrowthBadge value={25} />);
    const badge = screen.getByText('25%').closest('div')!;
    expect(badge.className).toMatch(/green/);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('shows a fall in a calm neutral colour, never alarm red', () => {
    render(<GrowthBadge value={-26.7} />);
    const badge = screen.getByText('26.7%').closest('div')!;
    expect(badge.className).not.toMatch(/red|destructive/);
    expect(badge.className).toMatch(/slate/);
  });

  it('says there is no change for zero', () => {
    render(<GrowthBadge value={0} />);
    expect(screen.getByText('No change')).toBeInTheDocument();
  });

  it('adds context after the figure when asked', () => {
    render(<GrowthBadge value={12} suffix="vs last month" />);
    expect(screen.getByText('12%')).toBeInTheDocument();
    expect(screen.getByText('vs last month')).toBeInTheDocument();
  });

  it('gives screen readers one sentence', () => {
    render(<GrowthBadge value={-10} suffix="vs last month" />);
    expect(screen.getByLabelText('Down 10% vs last month')).toBeInTheDocument();
    render(<GrowthBadge value={5} suffix="vs last month" />);
    expect(screen.getByLabelText('Up 5% vs last month')).toBeInTheDocument();
  });

  it('shows a count as a number, not a percentage', () => {
    render(<GrowthBadge value={3} unit="count" />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByText('3%')).not.toBeInTheDocument();
  });

  it('shows zero as 0 for a count, where "no change" would read oddly', () => {
    render(<GrowthBadge value={0} unit="count" />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('No change')).not.toBeInTheDocument();
  });

  it('renders nothing when the server gave no figure', () => {
    const { container } = render(<GrowthBadge value={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
