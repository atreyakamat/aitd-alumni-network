'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chapterApi, getApiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import type { Chapter } from '@/types';

export const MY_CHAPTERS_KEY = ['chapters', 'my'] as const;

/**
 * The signed-in user's chapter memberships plus join/leave actions.
 * Anonymous viewers get an empty membership set and no requests.
 */
export function useChapterMembership() {
  const { user, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const signedIn = !!user && isAuthenticated !== false;

  const myChaptersQuery = useQuery({
    queryKey: [...MY_CHAPTERS_KEY, user?.id],
    enabled: signedIn,
    queryFn: async (): Promise<Chapter[]> => {
      const res = await chapterApi.getMyChapters();
      const list = res.data?.data ?? [];
      return Array.isArray(list) ? list : [];
    },
  });

  const memberOf = React.useMemo(
    () => new Set((myChaptersQuery.data ?? []).map((c) => c.id)),
    [myChaptersQuery.data]
  );

  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'join' | 'leave'; name?: string }) =>
      action === 'join' ? chapterApi.joinChapter(id) : chapterApi.leaveChapter(id),
    onMutate: ({ id }) => setPendingId(id),
    onSuccess: (_res, { action, name }) => {
      toast({
        title: action === 'join' ? 'Joined chapter' : 'Left chapter',
        description: name ? (action === 'join' ? `Welcome to ${name}.` : `You are no longer a member of ${name}.`) : undefined,
      });
    },
    onError: (err, { action }) => {
      toast({
        variant: 'destructive',
        title: action === 'join' ? 'Could not join chapter' : 'Could not leave chapter',
        description: getApiErrorMessage(err, 'Please try again.'),
      });
    },
    onSettled: () => {
      setPendingId(null);
      // Membership changes affect counts on the list, the detail page and the members list.
      queryClient.invalidateQueries({ queryKey: ['chapters'] });
    },
  });

  return {
    signedIn,
    isLoadingMemberships: signedIn && myChaptersQuery.isLoading,
    isMember: (id: string) => memberOf.has(id),
    pendingId,
    join: (id: string, name?: string) => mutation.mutate({ id, action: 'join', name }),
    leave: (id: string, name?: string) => mutation.mutate({ id, action: 'leave', name }),
  };
}
