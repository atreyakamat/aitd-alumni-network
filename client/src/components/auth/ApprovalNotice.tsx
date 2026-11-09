import { Hourglass, MailWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APPROVAL_COPY } from '@/lib/approval';
import type { ApprovalState } from '@/lib/api';

/**
 * A calm notice (not a red error) for somebody the platform cannot let in because an administrator has not approved the
 * registration yet, or has not approved it at all. Nothing is broken and nothing is wrong with the password.
 */
export function ApprovalNotice({ state, className }: { state: ApprovalState; className?: string }) {
  const copy = APPROVAL_COPY[state];
  const Icon = state === 'pending' ? Hourglass : MailWarning;
  return (
    <div
      role="status"
      data-approval-state={state}
      className={cn(
        'flex gap-3 rounded-lg border px-4 py-3 font-body',
        state === 'pending' ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-amber-200 bg-amber-50 text-amber-900',
        className
      )}
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div>
        <p className="font-medium">{copy.title}</p>
        <p className="mt-1 text-sm">{copy.body}</p>
      </div>
    </div>
  );
}
