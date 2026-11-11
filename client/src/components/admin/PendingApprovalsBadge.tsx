import { cn } from '@/lib/utils';
import { pluralize } from '@/lib/format';

/** The number of registrations waiting for an administrator, as a small badge. Nothing when there are none or it is unknown. */
export function PendingApprovalsBadge({ count, className }: { count: number | null; className?: string }) {
  if (!count) return null;
  return (
    <span
      aria-label={`${pluralize(count, 'registration')} waiting for approval`}
      className={cn(
        'ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold leading-5 text-white',
        className
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
