'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FollowButton } from '@/components/social/FollowButton';
import { useAuth } from '@/context/auth-context';
import { useCursorList } from '@/hooks/use-cursor-list';
import { REACTIONS, REACTION_TYPES, mediaSrc, socialApi, type AuthorLite, type ReactionEntry, type ReactionSummary, type ReactionType } from '@/lib/social';
import { cn, getInitials } from '@/lib/utils';

export function PersonRow({ person, trailing }: { person: AuthorLite; trailing?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Link href={`/profile/${encodeURIComponent(person.id)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="h-10 w-10">
          <AvatarImage src={mediaSrc(person.profilePhotoUrl) || undefined} alt="" />
          <AvatarFallback className="bg-primary/10 text-xs text-primary">{getInitials(person.fullName)}</AvatarFallback>
        </Avatar>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{person.fullName}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {[person.currentDesignation, person.batchYear ? `Batch ${person.batchYear}` : null].filter(Boolean).join(' · ')}
          </span>
        </span>
      </Link>
      {trailing}
    </li>
  );
}

function ListFooter({ loading, loadingMore, error, hasMore, empty, onMore, onRetry, emptyText }: {
  loading: boolean; loadingMore: boolean; error: string | null; hasMore: boolean; empty: boolean; onMore: () => void; onRetry: () => void; emptyText: string;
}) {
  if (loading) return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading" /></div>;
  if (error) return (
    <div className="py-4 text-center text-sm">
      <p role="alert" className="text-destructive">{error}</p>
      <Button variant="link" onClick={onRetry}>Try again</Button>
    </div>
  );
  if (empty) return <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>;
  if (hasMore) return (
    <div className="flex justify-center py-2">
      <Button variant="ghost" size="sm" onClick={onMore} disabled={loadingMore}>
        {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}Show more
      </Button>
    </div>
  );
  return null;
}

/** Who reacted to a post, filterable by reaction type. */
export function ReactionsDialog({ postId, open, onOpenChange, summary, total }: {
  postId: string; open: boolean; onOpenChange: (open: boolean) => void; summary: ReactionSummary; total: number;
}) {
  const [filter, setFilter] = useState<ReactionType | 'ALL'>('ALL');
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) =>
      socialApi.reactions(postId, { type: filter === 'ALL' ? undefined : filter, cursor }, { signal }),
    [postId, filter]
  );
  const list = useCursorList<ReactionEntry>(fetchPage, `${postId}:${filter}`, (e) => e.user.id, { enabled: open });
  const types = REACTION_TYPES.filter((t) => (summary[t] ?? 0) > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reactions</DialogTitle>
          <DialogDescription className="sr-only">People who reacted to this post</DialogDescription>
        </DialogHeader>
        <div role="tablist" aria-label="Filter by reaction" className="flex flex-wrap gap-1 border-b pb-2">
          <button role="tab" aria-selected={filter === 'ALL'} onClick={() => setFilter('ALL')}
            className={cn('rounded-full px-3 py-1 text-sm', filter === 'ALL' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
            All {total}
          </button>
          {types.map((t) => {
            const R = REACTIONS[t];
            const Icon = R.icon;
            return (
              <button key={t} role="tab" aria-selected={filter === t} aria-label={`${R.label} ${summary[t]}`} onClick={() => setFilter(t)}
                className={cn('flex items-center gap-1 rounded-full px-3 py-1 text-sm', filter === t ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted')}>
                <Icon className={cn('h-4 w-4', R.colorClass)} aria-hidden="true" />{summary[t]}
              </button>
            );
          })}
        </div>
        <ul className="max-h-[50vh] overflow-y-auto">
          {list.items.map((entry) => {
            const R = REACTIONS[entry.type];
            const Icon = R.icon;
            return (
              <PersonRow key={entry.user.id} person={entry.user}
                trailing={<span className={cn('flex h-7 w-7 items-center justify-center rounded-full', R.bgClass, R.colorClass)} title={R.label}><Icon className="h-4 w-4" aria-label={R.label} /></span>} />
            );
          })}
        </ul>
        <ListFooter {...list} empty={!list.loading && list.items.length === 0} onMore={list.loadMore} onRetry={list.reload} emptyText="No reactions yet." />
      </DialogContent>
    </Dialog>
  );
}

/** Followers / following of a member, each with a follow toggle. */
export function FollowListDialog({ userId, kind, open, onOpenChange }: {
  userId: string; kind: 'followers' | 'following'; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) =>
      kind === 'followers' ? socialApi.followers(userId, cursor, { signal }) : socialApi.following(userId, cursor, { signal }),
    [userId, kind]
  );
  const list = useCursorList(fetchPage, `${userId}:${kind}`, (p) => p.id, { enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === 'followers' ? 'Followers' : 'Following'}</DialogTitle>
          <DialogDescription className="sr-only">{kind === 'followers' ? 'People who follow this member' : 'People this member follows'}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[60vh] overflow-y-auto">
          {list.items.map((person) => (
            <PersonRow key={person.id} person={person}
              trailing={user && person.id !== user.id ? <FollowButton userId={person.id} name={person.fullName} following={person.viewerFollows} /> : null} />
          ))}
        </ul>
        <ListFooter {...list} empty={!list.loading && list.items.length === 0} onMore={list.loadMore} onRetry={list.reload}
          emptyText={kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'} />
      </DialogContent>
    </Dialog>
  );
}
