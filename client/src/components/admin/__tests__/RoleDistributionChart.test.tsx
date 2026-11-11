import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('recharts', () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Stub, PieChart: Stub, Pie: Stub, Cell: () => null, Tooltip: () => null };
});

import { RoleDistributionChart } from '@/components/admin/RoleDistributionChart';

const roles = [
  { role: 'MEMBER', count: 22 },
  { role: 'CHAPTER_ADMIN', count: 1 },
  { role: 'ADMIN', count: 1 },
  { role: 'SUPER_ADMIN', count: 1 },
];

describe('<RoleDistributionChart>', () => {
  it('lists people-friendly role names, one entry per role, never the raw enum', () => {
    render(<RoleDistributionChart byRole={roles} />);
    const legend = screen.getByRole('list', { name: 'Roles' });
    const items = within(legend).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent('Member');
    expect(items[1]).toHaveTextContent('Chapter Admin');
    expect(items[2]).toHaveTextContent('Admin');
    expect(items[3]).toHaveTextContent('Super Admin');
    expect(legend.textContent).not.toMatch(/SUPER_ADMIN|CHAPTER_ADMIN|MEMBER/);
  });

  it('separates each name from its figures, so entries do not run together', () => {
    render(<RoleDistributionChart byRole={roles} />);
    const items = within(screen.getByRole('list', { name: 'Roles' })).getAllByRole('listitem');
    // "Member 22 (88%)", not "Member22(88%)SUPER_ADMIN(4%)"
    expect(items[0].textContent).toMatch(/^Member\s*22\s*\(88%\)$/);
    expect(items[3].textContent).toMatch(/^Super Admin\s*1\s*\(4%\)$/);
  });

  it('shows a calm empty state without any members', () => {
    render(<RoleDistributionChart byRole={[]} />);
    expect(screen.getByText('No members yet')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
