'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { assignableRoles, normalizeRole, roleLabel, type Role } from '@/lib/roles';

interface UserRoleSelectProps {
  /** Role of the signed-in admin performing the change. */
  actorRole: unknown;
  /** Current role of the user in this row. */
  targetRole: unknown;
  /** True when the row is the signed-in admin's own account. */
  isSelf?: boolean;
  /** Used for the accessible label, e.g. "Role for Ada Lovelace". */
  userName: string;
  onChange: (role: Role) => void;
  disabled?: boolean;
  className?: string;
}

export const roleBadgeClass: Record<Role, string> = {
  MEMBER: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  CHAPTER_ADMIN: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  ADMIN: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  SUPER_ADMIN: 'bg-purple-100 text-purple-800 hover:bg-purple-100',
};

/**
 * Role picker for the admin users table. Only offers roles `canAssignRole`
 * allows (mirrors the server hierarchy); renders a read-only badge when the
 * actor cannot change this user's role at all.
 */
export function UserRoleSelect({
  actorRole,
  targetRole,
  isSelf = false,
  userName,
  onChange,
  disabled,
  className,
}: UserRoleSelectProps) {
  const current = normalizeRole(targetRole);
  const options = assignableRoles(actorRole, current, { isSelf });

  if (options.length <= 1) {
    const reason = isSelf
      ? 'You cannot change your own role'
      : "You don't have permission to change this user's role";
    return (
      <Badge variant="secondary" className={cn(roleBadgeClass[current], className)} title={reason}>
        {roleLabel(current)}
      </Badge>
    );
  }

  return (
    <select
      aria-label={`Role for ${userName}`}
      value={current}
      disabled={disabled}
      onChange={(e) => {
        const next = normalizeRole(e.target.value);
        if (next !== current) onChange(next);
      }}
      className={cn(
        'h-9 rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {options.map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
        </option>
      ))}
    </select>
  );
}
