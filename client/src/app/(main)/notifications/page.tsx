'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Bell, Check, CheckCheck, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { NotificationContent } from '@/components/notifications/NotificationContent';
import {
  useNotificationActions,
  useNotificationList,
  useUnreadNotificationCount,
} from '@/hooks/use-notifications';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { getNotificationHref } from '@/lib/notifications';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';

const NOTIFICATIONS_PAGE_SIZE = 20;

type Filter = 'all' | 'unread';

export default function NotificationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);

  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const list = useNotificationList({ page, limit: NOTIFICATIONS_PAGE_SIZE, unreadOnly: filter === 'unread' });
  const { markRead, markAllRead, remove } = useNotificationActions();

  const items = list.data?.items ?? [];
  const totalPages = Math.max(1, list.data?.totalPages ?? 1);

  // Deleting / reading the last item of a later page: step back instead of showing an empty page.
  useEffect(() => {
    if (!list.isFetching && list.data && list.data.items.length === 0 && page > 1) {
      setPage((p) => Math.max(1, p - 1));
    }
  }, [list.isFetching, list.data, page]);

  const reportError = (title: string) => (error: unknown) =>
    toast({ variant: 'destructive', title, description: getApiErrorMessage(error, 'Please try again.') });

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setPage(1);
  };

  const openNotification = (notification: Notification) => {
    if (!notification.isRead) {
      markRead.mutate(notification.id, { onError: reportError('Could not mark as read') });
    }
    const href = getNotificationHref(notification);
    if (href) router.push(href);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground">
            {unreadCount > 0 ? `You have ${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}.` : "You're all caught up."}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={unreadCount === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate(undefined, { onError: reportError('Could not mark all as read') })}
        >
          <CheckCheck className="mr-2 h-4 w-4" />
          Mark all as read
        </Button>
      </div>

      <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="group" aria-label="Filter notifications">
        {(['all', 'unread'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? 'default' : 'ghost'}
            aria-pressed={filter === value}
            onClick={() => changeFilter(value)}
          >
            {value === 'all' ? 'All' : 'Unread'}
          </Button>
        ))}
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-16" role="status" aria-label="Loading notifications">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : list.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Couldn&apos;t load notifications</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {getApiErrorMessage(list.error, 'Something went wrong. Please try again.')}
            <Button size="sm" variant="outline" onClick={() => list.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-muted/20 py-16 text-center">
          <Bell className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-30" />
          <h2 className="text-lg font-medium">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {filter === 'unread'
              ? 'Everything has been read.'
              : 'Connection requests, comments, event updates and more will show up here.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2" aria-label="Notifications">
            {items.map((notification) => {
              const href = getNotificationHref(notification);
              return (
                <li key={notification.id}>
                  <Card className={cn('transition-colors', !notification.isRead && 'border-primary/30 bg-primary/5')}>
                    <CardContent className="flex items-start gap-2 p-4">
                      <button
                        type="button"
                        className={cn(
                          'flex min-w-0 flex-1 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          href || !notification.isRead ? 'cursor-pointer' : 'cursor-default'
                        )}
                        onClick={() => openNotification(notification)}
                        aria-label={`${notification.title}${notification.isRead ? '' : ' (unread)'}${href ? ', open' : ''}`}
                      >
                        <NotificationContent notification={notification} />
                      </button>
                      <div className="flex shrink-0 gap-1">
                        {!notification.isRead && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={`Mark "${notification.title}" as read`}
                            onClick={() =>
                              markRead.mutate(notification.id, { onError: reportError('Could not mark as read') })
                            }
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete "${notification.title}"`}
                          onClick={() =>
                            remove.mutate(notification, { onError: reportError('Could not delete notification') })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <nav className="flex items-center justify-center gap-2" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="px-3 text-sm font-medium">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
