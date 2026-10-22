'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NotificationContent } from '@/components/notifications/NotificationContent';
import {
  useNotificationActions,
  useNotificationList,
  useNotificationSocketSync,
  useUnreadNotificationCount,
} from '@/hooks/use-notifications';
import { formatBadgeCount, getNotificationHref } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';

export const BELL_PREVIEW_LIMIT = 10;

/** Nav bell: live unread badge plus a dropdown of the latest notifications (PRD 6.4). */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useNotificationSocketSync();
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const list = useNotificationList({ page: 1, limit: BELL_PREVIEW_LIMIT, enabled: open });
  const { markRead, markAllRead } = useNotificationActions();

  const badge = formatBadgeCount(unreadCount);
  const items = list.data?.items ?? [];

  const openNotification = (notification: Notification) => {
    if (!notification.isRead) markRead.mutate(notification.id);
    const href = getNotificationHref(notification);
    if (href) router.push(href);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        >
          <Bell className="h-5 w-5" />
          {badge && (
            <span
              data-testid="notification-badge"
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground"
            >
              {badge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          {/* A menu item (keyboard reachable) that keeps the menu open. */}
          <DropdownMenuItem
            className="h-7 cursor-pointer px-2 text-xs font-medium text-primary"
            disabled={unreadCount === 0 || markAllRead.isPending}
            onSelect={(event) => {
              event.preventDefault();
              markAllRead.mutate();
            }}
          >
            <CheckCheck className="mr-1 h-3.5 w-3.5" />
            Mark all as read
          </DropdownMenuItem>
        </div>
        <DropdownMenuSeparator className="my-0" />

        <div className="max-h-[22rem] overflow-y-auto py-1">
          {list.isLoading ? (
            <div className="flex items-center justify-center py-8" role="status" aria-label="Loading notifications">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : list.isError ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              <p>Couldn&apos;t load notifications.</p>
              <Button variant="link" size="sm" onClick={() => list.refetch()}>
                Try again
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            items.map((notification) => (
              <DropdownMenuItem
                key={notification.id}
                className={cn('cursor-pointer items-start px-3 py-2', !notification.isRead && 'bg-primary/5')}
                onSelect={() => openNotification(notification)}
              >
                <NotificationContent notification={notification} compact />
              </DropdownMenuItem>
            ))
          )}
        </div>

        <DropdownMenuSeparator className="my-0" />
        <DropdownMenuItem
          className="cursor-pointer justify-center py-2 text-sm font-medium text-primary"
          onSelect={() => router.push('/notifications')}
        >
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
