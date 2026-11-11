import { Ban, CheckCircle2, Clock, HelpCircle, XCircle, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ApprovalStatus } from '@/lib/api';

export type AccountStatus = 'PENDING' | 'REJECTED' | 'NOT_APPROVED' | 'DEACTIVATED' | 'ACTIVE';

interface Look {
  label: string;
  icon: LucideIcon;
  className: string;
}

const LOOKS: Record<AccountStatus, Look> = {
  PENDING: {
    label: 'Pending approval',
    icon: Clock,
    className: 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100',
  },
  REJECTED: {
    label: 'Rejected',
    icon: XCircle,
    className: 'border-red-300 bg-red-100 text-red-800 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100',
  },
  // The server did not say whether the person is waiting or was turned down: say only what is certain.
  NOT_APPROVED: {
    label: 'Not approved',
    icon: HelpCircle,
    className: 'border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100',
  },
  DEACTIVATED: {
    label: 'Deactivated',
    icon: Ban,
    className: 'border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200',
  },
  ACTIVE: {
    label: 'Active',
    icon: CheckCircle2,
    className: 'border-green-300 bg-green-100 text-green-800 hover:bg-green-100 dark:border-green-700 dark:bg-green-900/40 dark:text-green-100',
  },
};

/**
 * The one status an account has for the administrator. Not being approved comes first: a person who is waiting for a
 * decision, or was turned down, is not an "active" member whatever their `isActive` flag says. (`isVerified` means
 * "approved member", not "e-mail verified".)
 */
export function getAccountStatus(user: { isActive: boolean; isVerified: boolean; approvalStatus?: ApprovalStatus | null }): AccountStatus {
  if (user.approvalStatus === 'REJECTED') return 'REJECTED';
  if (user.approvalStatus === 'PENDING') return 'PENDING';
  if (!user.approvalStatus && !user.isVerified) return 'NOT_APPROVED';
  return user.isActive ? 'ACTIVE' : 'DEACTIVATED';
}

export function AccountStatusBadge({ status, className }: { status: AccountStatus; className?: string }) {
  const look = LOOKS[status];
  return (
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', look.className, className)}>
      <look.icon className="h-3 w-3" aria-hidden="true" />
      {look.label}
    </Badge>
  );
}

const APPROVAL_LOOKS: Record<ApprovalStatus, Look> = {
  PENDING: LOOKS.PENDING,
  REJECTED: LOOKS.REJECTED,
  APPROVED: { ...LOOKS.ACTIVE, label: 'Approved' },
};

/** Where a registration stands: Pending approval / Approved / Rejected. */
export function ApprovalStatusBadge({ status, className }: { status: ApprovalStatus; className?: string }) {
  const look = APPROVAL_LOOKS[status];
  return (
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap', look.className, className)}>
      <look.icon className="h-3 w-3" aria-hidden="true" />
      {look.label}
    </Badge>
  );
}
