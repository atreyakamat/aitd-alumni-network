'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  Clapperboard,
  Flag,
  HandHeart,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  ScrollText,
  UserCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePendingApprovals } from '@/hooks/use-pending-approvals';
import { PendingApprovalsBadge } from '@/components/admin/PendingApprovalsBadge';

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Items of one group sit together, with a divider between groups. */
  group: 'people' | 'content' | 'insight';
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, group: 'people' },
  { href: '/admin/approvals', label: 'Approvals', icon: UserCheck, group: 'people' },
  { href: '/admin/users', label: 'Members', icon: Users, group: 'people' },
  { href: '/admin/moderation', label: 'Moderation', icon: ClipboardCheck, group: 'people' },
  { href: '/admin/reports', label: 'Reports', icon: Flag, group: 'people' },
  { href: '/admin/videos', label: 'Videos', icon: Clapperboard, group: 'content' },
  { href: '/admin/magazine', label: 'Magazine', icon: BookOpen, group: 'content' },
  { href: '/admin/requirements', label: 'Requirements', icon: HandHeart, group: 'content' },
  { href: '/admin/landing', label: 'Landing page', icon: LayoutTemplate, group: 'content' },
  { href: '/admin/communications', label: 'Communications', icon: Mail, group: 'content' },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3, group: 'insight' },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText, group: 'insight' },
  { href: '/admin/status', label: 'System status', icon: Activity, group: 'insight' },
];

/** /admin is the overview and matches only itself; every other item also owns its sub-pages (but not a sibling with the same prefix). */
const isActive = (pathname: string | null, href: string) => {
  if (!pathname) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (href === '/admin') return path === '/admin';
  return path === href || path.startsWith(`${href}/`);
};

/**
 * The navigation bar at the top of every admin page. On a narrow screen it scrolls sideways inside its own box, so the
 * page itself never gets a horizontal scroll bar.
 */
export function AdminNav() {
  const pathname = usePathname();
  // Rendered inside the admin layout, i.e. only for administrators. Best effort: nothing is shown if the count is unknown.
  const pending = usePendingApprovals(true);
  const listRef = React.useRef<HTMLUListElement>(null);

  // Bring the current item into view when the page opens on a narrow screen (without scrolling the page itself).
  React.useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    const target = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
    list.scrollLeft = Math.max(0, target);
  }, [pathname]);

  return (
    <nav aria-label="Admin sections" className="min-w-0 max-w-full rounded-lg border bg-card shadow-sm">
      <ul ref={listRef} className="flex items-center gap-1 overflow-x-auto p-1.5 [scrollbar-width:thin]">
        {ADMIN_NAV_ITEMS.map((item, index) => {
          const active = isActive(pathname, item.href);
          const startsGroup = index > 0 && ADMIN_NAV_ITEMS[index - 1].group !== item.group;
          return (
            <React.Fragment key={item.href}>
              {startsGroup && <li aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />}
              <li className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background',
                    active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {item.label}
                  {item.href === '/admin/approvals' && <PendingApprovalsBadge count={pending} className="ml-0" />}
                </Link>
              </li>
            </React.Fragment>
          );
        })}
      </ul>
    </nav>
  );
}
