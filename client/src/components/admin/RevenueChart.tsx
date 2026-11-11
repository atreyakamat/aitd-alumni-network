'use client';

import { IndianRupee } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { hasAnyRevenue, type MonthlyRevenue } from '@/lib/admin-stats';
import { formatInr, formatInrCompact } from '@/lib/format';
import { cn } from '@/lib/utils';

const DONATIONS = '#002045';
const MEMBERSHIPS = '#b45309';

interface RevenueChartProps {
  data: MonthlyRevenue[];
  /** Tailwind height class of the chart area. */
  heightClass?: string;
}

/** Monthly donations and membership payments. With no money at all it says so instead of drawing an empty axis. */
export function RevenueChart({ data, heightClass = 'h-[300px]' }: RevenueChartProps) {
  if (!hasAnyRevenue(data)) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-2 text-center', heightClass)}>
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IndianRupee className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="font-medium">No donations yet</p>
        <p className="max-w-xs text-sm text-muted-foreground">Donations and membership payments will appear here month by month once they come in.</p>
      </div>
    );
  }

  return (
    <div className={heightClass}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
          <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis fontSize={12} tickLine={false} axisLine={false} width={56} allowDecimals={false} tickFormatter={(v) => formatInrCompact(v)} />
          <Tooltip
            formatter={(v) => formatInr(v)}
            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
          />
          <Legend />
          <Bar dataKey="donations" fill={DONATIONS} radius={[4, 4, 0, 0]} name="Donations" />
          <Bar dataKey="memberships" fill={MEMBERSHIPS} radius={[4, 4, 0, 0]} name="Memberships" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
