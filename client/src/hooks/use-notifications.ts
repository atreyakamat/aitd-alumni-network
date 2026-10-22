'use client';

import { useEffect } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi, readPaginated, type PageOf } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { NEW_NOTIFICATION_EVENT } from '@/lib/notifications';
import type { Notification } from '@/types';

export const notificationKeys = {
  all: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  lists: ['notifications', 'list'] as const,
  list: (page: number, limit: number, unreadOnly: boolean) =>
    ['notifications', 'list', { page, limit, unreadOnly }] as const,
};

/**
 * Keep notification caches live: bump the unread count and refresh lists when
 * the socket delivers a `new_notification`. Mount once (the nav bell does).
 */
export function useNotificationSocketSync() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated) return;
    const onNew = () => {
      queryClient.setQueryData<number>(notificationKeys.unreadCount, (count) => (count ?? 0) + 1);
      void queryClient.invalidateQueries({ queryKey: notificationKeys.lists });
    };
    window.addEventListener(NEW_NOTIFICATION_EVENT, onNew);
    return () => window.removeEventListener(NEW_NOTIFICATION_EVENT, onNew);
  }, [isAuthenticated, queryClient]);
}

/** Unread notification count for the signed-in user; refetches on window focus. */
export function useUnreadNotificationCount() {
  const { isAuthenticated } = useAuth();

  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: async () => {
      const res = await notificationApi.getUnreadCount();
      return Number(res.data?.data?.unreadCount ?? 0) || 0;
    },
    enabled: isAuthenticated,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function useNotificationList(options: {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  enabled?: boolean;
}) {
  const { page = 1, limit = 20, unreadOnly = false, enabled = true } = options;
  const { isAuthenticated } = useAuth();

  return useQuery<PageOf<Notification>>({
    queryKey: notificationKeys.list(page, limit, unreadOnly),
    queryFn: async () => {
      const res = await notificationApi.getNotifications(page, limit, unreadOnly);
      return readPaginated<Notification>(res.data);
    },
    enabled: isAuthenticated && enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

/** Mark-read / mark-all / delete with optimistic cache updates. */
export function useNotificationActions() {
  const queryClient = useQueryClient();

  const patchLists = (update: (items: Notification[]) => Notification[]) => {
    queryClient.setQueriesData<PageOf<Notification>>({ queryKey: notificationKeys.lists }, (old) =>
      old ? { ...old, items: update(old.items) } : old
    );
  };

  const invalidate = () => queryClient.invalidateQueries({ queryKey: notificationKeys.all });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationApi.markAsRead(id),
    onMutate: (id) => {
      patchLists((items) => items.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      queryClient.setQueryData<number>(notificationKeys.unreadCount, (c) => Math.max(0, (c ?? 0) - 1));
    },
    onSettled: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => notificationApi.markAllAsRead(),
    onMutate: () => {
      patchLists((items) => items.map((n) => ({ ...n, isRead: true })));
      queryClient.setQueryData<number>(notificationKeys.unreadCount, 0);
    },
    onSettled: invalidate,
  });

  const remove = useMutation({
    mutationFn: (notification: Notification) => notificationApi.deleteNotification(notification.id),
    onMutate: (notification) => {
      patchLists((items) => items.filter((n) => n.id !== notification.id));
      if (!notification.isRead) {
        queryClient.setQueryData<number>(notificationKeys.unreadCount, (c) => Math.max(0, (c ?? 0) - 1));
      }
    },
    onSettled: invalidate,
  });

  return { markRead, markAllRead, remove };
}
