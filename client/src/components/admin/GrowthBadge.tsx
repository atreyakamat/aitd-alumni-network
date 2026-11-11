import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface GrowthBadgeProps {
  /** Percent (default) or an absolute count; null/undefined when there is no figure. */
  value: number | null | undefined;
  unit?: 'percent' | 'count';
  /** Context shown after the figure, e.g. "vs last month". */
  suffix?: string;
  className?: string;
}

const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/**
 * A change next to a headline number. Growth is green; a fall is a calm neutral grey and never alarm red (fewer sign-ups
 * in a month is not an incident), and "no change" says so in words.
 */
export function GrowthBadge({ value, unit = 'percent', suffix, className }: GrowthBadgeProps) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;

  const rounded = oneDecimal(value);
  const direction = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  const figure = `${Math.abs(rounded)}${unit === 'percent' ? '%' : ''}`;
  const spoken = direction === 'flat' ? (unit === 'count' ? '0' : 'No change') : `${direction === 'up' ? 'Up' : 'Down'} ${figure}`;
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;

  return (
    <Badge
      variant="outline"
      role="img"
      aria-label={suffix ? `${spoken} ${suffix}` : spoken}
      className={cn(
        'gap-1 whitespace-nowrap',
        direction === 'up'
          ? 'border-green-200 bg-green-100 text-green-800 hover:bg-green-100'
          : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100',
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {direction === 'flat' ? <span>{unit === 'count' ? '0' : 'No change'}</span> : <span>{figure}</span>}
      {suffix && <span className="font-normal opacity-80">{suffix}</span>}
    </Badge>
  );
}
