'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, Clapperboard, Loader2, MessageCircle, Pause, Play, Plus, Repeat2, Share2, Volume2, VolumeX } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CommentThread } from '@/components/social/CommentThread';
import { FollowButton } from '@/components/social/FollowButton';
import { PostComposer } from '@/components/social/PostComposer';
import { prefersReducedMotion, safePlay } from '@/components/social/PostMedia';
import { ReactionButton } from '@/components/social/ReactionButton';
import { RichText } from '@/components/social/RichText';
import { usePostInteractions } from '@/components/social/use-post-interactions';
import { useAuth } from '@/context/auth-context';
import { useCursorList } from '@/hooks/use-cursor-list';
import { REACTIONS, compactCount, mediaSrc, recordViewOnce, socialApi, type SocialPost } from '@/lib/social';
import { cn, getInitials } from '@/lib/utils';

const ACTIVE_RATIO = 0.7;

/** Index to move to for an arrow key, clamped to the list. */
export const reelIndexForKey = (key: string, current: number, total: number): number | null => {
  if (total === 0) return null;
  if (key === 'ArrowDown' || key === 'PageDown' || key === 'j') return Math.min(total - 1, current + 1);
  if (key === 'ArrowUp' || key === 'PageUp' || key === 'k') return Math.max(0, current - 1);
  return null;
};

/** Full-height, snap-scrolling reels: the reel ≥ 70 % on screen plays (muted until unmuted); others pause. */
export function ReelsViewer({ startId }: { startId?: string | null }) {
  const { user } = useAuth();
  const fetchPage = useCallback((cursor: string | null, signal: AbortSignal) => socialApi.reels(cursor, { signal }), []);
  const list = useCursorList<SocialPost>(fetchPage, 'reels', (p) => p.id);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [creating, setCreating] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLElement>());
  const startHandled = useRef(false);

  // Make sure a deep-linked reel (/reels?start=<id>) is in the list and on screen.
  useEffect(() => {
    if (!startId || startHandled.current || list.loading) return;
    startHandled.current = true;
    const index = list.items.findIndex((p) => p.id === startId);
    if (index >= 0) {
      setActive(index);
      requestAnimationFrame(() => itemRefs.current.get(startId)?.scrollIntoView({ block: 'start' }));
      return;
    }
    socialApi
      .getPost(startId)
      .then((post) => {
        if (post.isReel && post.videoUrl) {
          list.prepend(post);
          setActive(0);
        }
      })
      .catch(() => undefined);
  }, [startId, list]);

  // Track which reel is mostly on screen.
  useEffect(() => {
    const root = container.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= ACTIVE_RATIO) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (Number.isInteger(index)) setActive(index);
          }
        }
      },
      { root, threshold: [ACTIVE_RATIO] }
    );
    itemRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [list.items]);

  // Prefetch the next page near the end.
  useEffect(() => {
    if (list.items.length > 0 && active >= list.items.length - 2) list.loadMore();
  }, [active, list]);

  const goTo = (index: number) => {
    const post = list.items.at(index);
    if (!post) return;
    setActive(index);
    itemRefs.current.get(post.id)?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold"><Clapperboard className="h-5 w-5 text-primary" aria-hidden="true" />Reels</h1>
        {user && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Create reel
          </Button>
        )}
      </div>

      {list.loading ? (
        <div className="flex h-[60vh] items-center justify-center rounded-xl bg-muted"><Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading reels" /></div>
      ) : list.error && list.items.length === 0 ? (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 rounded-xl bg-muted text-center">
          <p role="alert" className="text-sm text-destructive">{list.error}</p>
          <Button variant="outline" onClick={list.reload}>Try again</Button>
        </div>
      ) : list.items.length === 0 ? (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 rounded-xl bg-muted px-6 text-center">
          <Clapperboard className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">No reels yet</p>
          <p className="text-sm text-muted-foreground">Share a short vertical video from a reunion, a campus visit or your workplace.</p>
          {user && <Button onClick={() => setCreating(true)}>Create the first reel</Button>}
        </div>
      ) : (
        <div
          ref={container}
          tabIndex={0}
          role="feed"
          aria-label="Reels. Use the up and down arrow keys to move between reels."
          aria-busy={list.loadingMore}
          onKeyDown={(e) => {
            const next = reelIndexForKey(e.key, active, list.items.length);
            if (next !== null && e.target === e.currentTarget) {
              e.preventDefault();
              goTo(next);
            }
          }}
          className="h-[calc(100dvh-10rem)] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {list.items.map((post, index) => (
            <article
              key={post.id}
              ref={(el) => {
                if (el) itemRefs.current.set(post.id, el);
                else itemRefs.current.delete(post.id);
              }}
              data-index={index}
              aria-posinset={index + 1}
              aria-setsize={list.hasMore ? -1 : list.items.length}
              aria-label={`Reel by ${post.user.fullName}`}
              className="relative h-full w-full snap-start snap-always"
            >
              <ReelItem
                post={post}
                active={index === active}
                muted={muted}
                onToggleMute={() => setMuted((m) => !m)}
                onChange={(next) => list.update(post.id, () => next)}
              />
            </article>
          ))}
          {list.loadingMore && (
            <div className="flex h-24 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-white" aria-label="Loading more reels" /></div>
          )}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create a reel</DialogTitle>
            <DialogDescription>Vertical videos up to 100 MB work best.</DialogDescription>
          </DialogHeader>
          <PostComposer
            mode="reel"
            className="border-0 p-0 shadow-none"
            onCreated={(post) => {
              setCreating(false);
              if (post.isReel) {
                list.prepend(post);
                requestAnimationFrame(() => goTo(0));
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReelItem({
  post,
  active,
  muted,
  onToggleMute,
  onChange,
}: {
  post: SocialPost;
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onChange: (post: SocialPost) => void;
}) {
  const { user } = useAuth();
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const actions = usePostInteractions(post, onChange);
  const isOwn = !!user && (post.viewer.isAuthor || post.user.id === user.id);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    if (active) {
      recordViewOnce(post.id);
      if (!prefersReducedMotion()) {
        safePlay(el, () => setPaused(true));
        setPaused(false);
      } else {
        setPaused(true);
      }
    } else {
      el.pause();
    }
  }, [active, post.id]);

  const togglePlay = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) {
      safePlay(el);
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };

  const ReactionIcon = post.viewer.reaction ? REACTIONS[post.viewer.reaction].icon : null;

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <video
        ref={video}
        src={mediaSrc(post.videoUrl)}
        poster={post.thumbnailUrl ? mediaSrc(post.thumbnailUrl) : undefined}
        muted={muted}
        loop
        playsInline
        preload={active ? 'auto' : 'metadata'}
        onClick={togglePlay}
        aria-label={`Reel by ${post.user.fullName}`}
        className="h-full w-full cursor-pointer object-contain"
      />
      <button
        type="button"
        onClick={togglePlay}
        aria-label={paused ? 'Play reel' : 'Pause reel'}
        className={cn('absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/50 p-4 text-white transition-opacity', paused ? 'opacity-100' : 'opacity-0 focus:opacity-100')}
      >
        {paused ? <Play className="h-8 w-8" aria-hidden="true" /> : <Pause className="h-8 w-8" aria-hidden="true" />}
      </button>
      <button type="button" onClick={onToggleMute} aria-label={muted ? 'Unmute' : 'Mute'} className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white hover:bg-black/70">
        {muted ? <VolumeX className="h-5 w-5" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
      </button>

      {/* Caption + author */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pr-20 text-white">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link href={`/profile/${encodeURIComponent(post.user.id)}`} className="flex items-center gap-2">
            <Avatar className="h-9 w-9 border border-white/60">
              <AvatarImage src={mediaSrc(post.user.profilePhotoUrl) || undefined} alt="" />
              <AvatarFallback className="text-xs text-foreground">{getInitials(post.user.fullName)}</AvatarFallback>
            </Avatar>
            <span className="text-sm font-semibold">{post.user.fullName}</span>
          </Link>
          {user && !isOwn && !post.viewer.followsAuthor && (
            <FollowButton
              userId={post.user.id}
              name={post.user.fullName}
              following={false}
              hideWhenFollowing
              className="h-7 border-white/70 bg-transparent px-2 text-xs text-white hover:bg-white/20"
              onChange={(following) => onChange({ ...post, viewer: { ...post.viewer, followsAuthor: following } })}
            />
          )}
        </div>
        {post.content && (
          <div className="pointer-events-auto mt-2">
            <RichText text={post.content} mentions={post.mentions} className={cn('text-white [&_a]:text-white [&_a]:underline', !expanded && 'line-clamp-2')} />
            {post.content.length > 120 && (
              <button type="button" onClick={() => setExpanded((e) => !e)} className="text-xs font-medium text-white/80">
                {expanded ? 'Show less' : 'More'}
              </button>
            )}
          </div>
        )}
        {post.counts.views > 0 && <p className="mt-1 text-xs text-white/70">{compactCount(post.counts.views)} views</p>}
      </div>

      {/* Action rail */}
      <div className="absolute bottom-6 right-2 flex flex-col items-center gap-4 text-white">
        {user ? (
          <div className="flex flex-col items-center [&_button]:text-white">
            <ReactionButton reaction={post.viewer.reaction} onReact={actions.react} disabled={actions.busy.react} size="sm" label="reel" />
            <span className="text-xs">{compactCount(post.counts.reactions)}</span>
            {ReactionIcon && <span className="sr-only">You reacted {post.viewer.reaction}</span>}
          </div>
        ) : null}
        <RailButton label={`Comments (${post.counts.comments})`} onClick={() => setCommentsOpen(true)} count={post.counts.comments}>
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        </RailButton>
        {user && (
          <RailButton
            label={post.viewer.reposted ? 'Undo repost' : 'Repost'}
            onClick={actions.toggleRepost}
            pressed={post.viewer.reposted}
            disabled={actions.busy.repost || (!post.viewer.reposted && post.visibility !== 'PUBLIC')}
            count={post.counts.reposts}
          >
            <Repeat2 className={cn('h-6 w-6', post.viewer.reposted && 'text-green-400')} aria-hidden="true" />
          </RailButton>
        )}
        <RailButton label="Share" onClick={actions.share}>
          <Share2 className="h-6 w-6" aria-hidden="true" />
        </RailButton>
        {user && (
          <RailButton label={post.viewer.saved ? 'Unsave' : 'Save'} onClick={actions.toggleSave} pressed={post.viewer.saved} disabled={actions.busy.save}>
            {post.viewer.saved ? <BookmarkCheck className="h-6 w-6 text-yellow-300" aria-hidden="true" /> : <Bookmark className="h-6 w-6" aria-hidden="true" />}
          </RailButton>
        )}
      </div>

      <Dialog open={commentsOpen} onOpenChange={setCommentsOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comments</DialogTitle>
            <DialogDescription className="sr-only">Comments on {post.user.fullName}’s reel</DialogDescription>
          </DialogHeader>
          <CommentThread
            post={post}
            autoFocus
            onCountChange={(delta) => onChange({ ...post, counts: { ...post.counts, comments: Math.max(0, post.counts.comments + delta) } })}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RailButton({ label, onClick, children, count, pressed, disabled }: {
  label: string; onClick: () => void; children: React.ReactNode; count?: number; pressed?: boolean; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      className="flex flex-col items-center gap-0.5 rounded-full p-1 drop-shadow hover:scale-110 disabled:opacity-50 motion-reduce:transform-none"
    >
      {children}
      {count !== undefined && count > 0 && <span className="text-xs">{compactCount(count)}</span>}
    </button>
  );
}
