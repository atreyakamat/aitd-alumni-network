'use client';

import { Users } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { roleChartData } from '@/lib/admin-stats';
import { cn } from '@/lib/utils';

export const ROLE_COLORS = ['#002045', '#1d4ed8', '#b45309', '#7c3aed', '#0f766e', '#64748b'];

interface RoleDistributionChartProps {
  byRole: Array<{ role: string; count: number }>;
  heightClass?: string;
}

/**
 * Members by role as a ring with a legend of its own: "Member 22 (88%)", one line per role, with the role named the way
 * people say it (the raw MEMBER / SUPER_ADMIN names never reach the screen).
 */
export function RoleDistributionChart({ byRole, heightClass = 'h-[170px]' }: RoleDistributionChartProps) {
  const slices = roleChartData(byRole);

  if (slices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Users className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="font-medium">No members yet</p>
        <p className="text-sm text-muted-foreground">Approved members will be counted here by role.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={cn(heightClass)}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3}>
              {slices.map((slice, index) => (
                <Cell key={slice.role} fill={ROLE_COLORS[index % ROLE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul aria-label="Roles" className="space-y-1.5 text-sm">
        {slices.map((slice, index) => (
          <li key={slice.role} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: ROLE_COLORS[index % ROLE_COLORS.length] }} aria-hidden="true" />
            <span className="font-medium">{slice.name}</span>{' '}
            <span className="ml-auto tabular-nums text-muted-foreground">
              {slice.value} ({slice.percent}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
