'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertCircle, Loader2, Newspaper, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PostCard } from '@/components/social/PostCard';
import { useCursorList, type FetchPage } from '@/hooks/use-cursor-list';
import { FEED_TABS, FEED_TAB_LABELS, socialApi, type FeedTab, type SocialPost } from '@/lib/social';
import { cn } from '@/lib/utils';

export interface PostListHandle {
  prepend: (post: SocialPost) => void;
  reload: () => void;
}

export function PostSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}

export interface EmptyState {
  title: string;
  body?: string;
  action?: React.ReactNode;
}

/** Infinite list of PostCards over any cursor endpoint. Loads the next page as the end comes into view. */
export const PostList = forwardRef<PostListHandle, {
  fetchPage: FetchPage<SocialPost>;
  listKey: string;
  empty: EmptyState;
  enabled?: boolean;
  /** Drop items from the list when they stop matching (e.g. unsaved on the Saved page). */
  keep?: (post: SocialPost) => boolean;
}>(function PostList({ fetchPage, listKey, empty, enabled = true, keep }, ref) {
  const list = useCursorList<SocialPost>(fetchPage, listKey, (p) => p.id, { enabled });
  const sentinel = useRef<HTMLDivElement>(null);
  const { loadMore, hasMore, loading, loadingMore } = list;

  useImperativeHandle(ref, () => ({ prepend: (post) => list.prepend(post), reload: list.reload }), [list]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, hasMore]);

  const items = keep ? list.items.filter(keep) : list.items;

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading posts">
        <PostSkeleton />
        <PostSkeleton />
      </div>
    );
  }

  if (list.error && items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" aria-hidden="true" />
          <p role="alert" className="text-sm text-muted-foreground">{list.error}</p>
          <Button variant="outline" onClick={list.reload}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Try again</Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <Newspaper className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
          <p className="font-semibold">{empty.title}</p>
          {empty.body && <p className="max-w-sm text-sm text-muted-foreground">{empty.body}</p>}
          {empty.action && <div className="mt-2">{empty.action}</div>}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-4" aria-label="Posts">
        {items.map((post) => (
          <li key={post.id}>
            <PostCard
              post={post}
              onChange={(next) => list.update(post.id, () => next)}
              onRemove={list.remove}
              onCreated={(created) => list.prepend(created)}
            />
          </li>
        ))}
      </ul>
      <div ref={sentinel} aria-hidden="true" />
      {loadingMore && (
        <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading more posts" /></div>
      )}
      {list.error && items.length > 0 && (
        <div className="text-center text-sm">
          <p role="alert" className="text-destructive">{list.error}</p>
          <Button variant="link" onClick={loadMore}>Try again</Button>
        </div>
      )}
      {hasMore && !loadingMore && !list.error && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={loadMore}>Load more</Button>
        </div>
      )}
      {!hasMore && items.length > 3 && <p className="py-4 text-center text-xs text-muted-foreground">You’re all caught up.</p>}
    </div>
  );
});

const TAB_STORAGE_KEY = 'feed.tab';

const EMPTY: Record<FeedTab, EmptyState> = {
  'for-you': { title: 'Your feed is quiet', body: 'Share an update, or follow and connect with alumni to see what they post.' },
  following: { title: 'Nothing from people you follow yet', body: 'Follow alumni from their profiles or the suggestions on the right. Your connections show up here too.' },
  latest: { title: 'No posts yet', body: 'Be the first to share something with the community.' },
};

function readStoredTab(): FeedTab {
  try {
    const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
    return (FEED_TABS as readonly string[]).includes(stored ?? '') ? (stored as FeedTab) : 'for-you';
  } catch {
    return 'for-you';
  }
}

/** The home feed: For you / Following / Latest. */
export const Feed = forwardRef<PostListHandle, { emptyAction?: React.ReactNode }>(function Feed({ emptyAction }, ref) {
  const [tab, setTab] = useState<FeedTab>('for-you');
  const listRef = useRef<PostListHandle>(null);

  useEffect(() => setTab(readStoredTab()), []);

  useImperativeHandle(ref, () => ({
    prepend: (post) => listRef.current?.prepend(post),
    reload: () => listRef.current?.reload(),
  }), []);

  const fetchPage = useCallback<FetchPage<SocialPost>>((cursor, signal) => socialApi.feed(tab, cursor, { signal }), [tab]);

  const select = (next: FeedTab) => {
    setTab(next);
    try {
      window.localStorage.setItem(TAB_STORAGE_KEY, next);
    } catch {
      // Remembering the tab is a convenience.
    }
  };

  return (
    <section aria-label="Feed" className="space-y-4">
      <div role="tablist" aria-label="Feed" className="flex gap-1 rounded-lg border bg-card p-1"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
          const i = FEED_TABS.indexOf(tab);
          const next = FEED_TABS.at((i + (e.key === 'ArrowRight' ? 1 : -1) + FEED_TABS.length) % FEED_TABS.length) ?? 'for-you';
          select(next);
          (e.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
        }}
      >
        {FEED_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            data-tab={t}
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => select(t)}
            className={cn('flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors', tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            {FEED_TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <PostList ref={listRef} fetchPage={fetchPage} listKey={tab} empty={{ ...EMPTY[tab], action: emptyAction }} />
    </section>
  );
});
