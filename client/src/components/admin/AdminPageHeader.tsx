import * as React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminPageHeaderProps {
  /** The page title: rendered as the page's single `<h1>`. */
  title: string;
  description?: React.ReactNode;
  /** Buttons for the right-hand side (wraps under the title on a narrow screen). */
  actions?: React.ReactNode;
  icon?: LucideIcon;
  /** Small status next to the title, e.g. "3 pending". Not part of the heading text. */
  badge?: React.ReactNode;
  className?: string;
}

/**
 * The header every admin page starts with, so titles, descriptions and action buttons sit in the same place on every
 * screen. The section navigation (AdminNav, rendered by the admin layout) replaces the old per-page "back" links.
 */
export function AdminPageHeader({ title, description, actions, icon: Icon, badge, className }: AdminPageHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-3 md:flex-row md:items-start md:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <span className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {badge}
          </div>
          {description && <p className="mt-1 text-sm text-muted-foreground md:text-base">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>}
    </header>
  );
}
