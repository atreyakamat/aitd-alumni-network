import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatTone = 'blue' | 'green' | 'amber' | 'purple' | 'teal' | 'rose' | 'slate';

const TONES: Record<StatTone, string> = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-200',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

interface StatTileProps {
  icon: LucideIcon;
  tone?: StatTone;
  /** What the number is: "Members". */
  label: string;
  value: React.ReactNode;
  /** A line of context under the label. */
  sub?: React.ReactNode;
  /** Something in the top-right corner, e.g. a growth badge. */
  badge?: React.ReactNode;
  /** Makes the whole tile a link. */
  href?: string;
  /** Draws attention (amber), e.g. for work that waits for the administrator. */
  highlight?: boolean;
  className?: string;
}

/** A headline number with its label: the building block of the dashboard and analytics pages. */
export function StatTile({ icon: Icon, tone = 'blue', label, value, sub, badge, href, highlight = false, className }: StatTileProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', highlight ? TONES.amber : TONES[tone])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        {badge}
      </div>
      <div className="mt-3">
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </div>
    </>
  );

  const box = cn(
    'block rounded-lg border p-6 shadow-sm',
    highlight ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30' : 'bg-card text-card-foreground',
    className
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          box,
          'transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background'
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={box}>{body}</div>;
}
