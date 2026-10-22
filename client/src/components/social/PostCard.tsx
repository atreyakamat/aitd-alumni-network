'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  Clapperboard,
  Flag,
  Link2,
  Loader2,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Quote,
  Repeat2,
  Share2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CommentThread } from '@/components/social/CommentThread';
import { ConfirmDialog } from '@/components/social/ConfirmDialog';
import { FollowButton } from '@/components/social/FollowButton';
import { MentionTextarea } from '@/components/social/MentionTextarea';
import { ReactionsDialog } from '@/components/social/PeopleList';
import { AutoplayVideo, ImageGrid } from '@/components/social/PostMedia';
import { ReactionButton, ReactionSummaryBadge } from '@/components/social/ReactionButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { RichText } from '@/components/social/RichText';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { isAdmin } from '@/lib/roles';
import { shareLinkWithToast } from '@/lib/share';
import {
  POST_CONTENT_MAX,
  activeMentionIds,
  applyPostReaction,
  compactCount,
  isPlainRepost,
  isUnavailablePost,
  mediaSrc,
  mergeReactionResponse,
  nextReaction,
  postUrl,
  recordViewOnce,
  relativeTime,
  socialApi,
  type AuthorLite,
  type MentionRef,
  type ReactionType,
  type SocialPost,
} from '@/lib/social';
import { cn, getInitials } from '@/lib/utils';

/** Apply `fn` to the post the viewer interacts with: the original for a plain repost, else the post itself. */
export function updateTarget(post: SocialPost, fn: (p: SocialPost) => SocialPost): SocialPost {
  if (isPlainRepost(post) && post.repostOf && !isUnavailablePost(post.repostOf)) {
    return { ...post, repostOf: fn(post.repostOf as SocialPost) };
  }
  return fn(post);
}

function AuthorAvatar({ author, size = 'md' }: { author: AuthorLite; size?: 'sm' | 'md' }) {
  return (
    <Link href={`/profile/${encodeURIComponent(author.id)}`} aria-label={`${author.fullName}'s profile`} className="shrink-0">
      <Avatar className={size === 'sm' ? 'h-8 w-8' : 'h-11 w-11'}>
        <AvatarImage src={mediaSrc(author.profilePhotoUrl) || undefined} alt="" />
        <AvatarFallback className="bg-primary/10 text-primary">{getInitials(author.fullName)}</AvatarFallback>
      </Avatar>
    </Link>
  );
}

function PostBody({ post, compact = false }: { post: SocialPost; compact?: boolean }) {
  return (
    <div className="space-y-3">
      {post.content && <RichText text={post.content} mentions={post.mentions} className={cn(compact && 'line-clamp-4')} />}
      {post.videoUrl ? (
        <AutoplayVideo
          src={post.videoUrl}
          poster={post.thumbnailUrl}
          label={post.isReel ? `Reel by ${post.user.fullName}` : `Video by ${post.user.fullName}`}
          className={cn(post.isReel && 'mx-auto max-w-sm')}
          onVisible={() => recordViewOnce(post.id)}
        />
      ) : (
        post.mediaUrls.length > 0 && <ImageGrid urls={post.mediaUrls} alt={`Image from ${post.user.fullName}'s post`} />
      )}
      {post.linkUrl && (
        <a href={post.linkUrl} target="_blank" rel="noopener noreferrer nofollow ugc" className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-primary hover:bg-muted">
          <Link2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{post.linkUrl}</span>
        </a>
      )}
    </div>
  );
}

/** The original inside a quote post. */
export function QuotedPost({ post }: { post: SocialPost['repostOf'] }) {
  if (!post) return null;
  if (isUnavailablePost(post)) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        This post is no longer available.
      </div>
    );
  }
  return (
    <div className="rounded-lg border p-3 transition-colors hover:bg-muted/30">
      <div className="mb-2 flex items-center gap-2">
        <AuthorAvatar author={post.user} size="sm" />
        <div className="min-w-0 text-sm">
          <Link href={`/profile/${encodeURIComponent(post.user.id)}`} className="font-semibold hover:underline">{post.user.fullName}</Link>
          <span className="text-muted-foreground"> · <Link href={`/posts/${encodeURIComponent(post.id)}`} className="hover:underline">{relativeTime(post.createdAt)}</Link></span>
        </div>
      </div>
      <PostBody post={post} compact />
    </div>
  );
}

export function PostCard({
  post,
  onChange,
  onRemove,
  onCreated,
  defaultCommentsOpen = false,
  highlightCommentId,
  className,
}: {
  post: SocialPost;
  onChange: (post: SocialPost) => void;
  onRemove?: (id: string) => void;
  /** A repost/quote the viewer just made, to show at the top of the feed. */
  onCreated?: (post: SocialPost) => void;
  defaultCommentsOpen?: boolean;
  highlightCommentId?: string | null;
  className?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const plain = isPlainRepost(post);
  const original = plain && post.repostOf && !isUnavailablePost(post.repostOf) ? (post.repostOf as SocialPost) : null;
  // What the card displays and what reactions/comments/saves act on.
  const shown = original ?? post;
  const [commentsOpen, setCommentsOpen] = useState(defaultCommentsOpen);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const viewerIsAdmin = isAdmin(user);
  const isAuthorOfItem = !!user && (post.viewer.isAuthor || post.user.id === user.id);
  const isAuthorOfShown = !!user && (shown.viewer.isAuthor || shown.user.id === user.id);

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    if (busy[key]) return;
    setBusy((b) => ({ ...b, [key]: true }));
    try {
      await fn();
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const fail = (title: string, err: unknown) =>
    toast({ variant: 'destructive', title, description: getApiErrorMessage(err, 'Please try again.') });

  // A plain repost whose original was deleted
  if (plain && !original) {
    return (
      <Card className={cn('shadow-sm', className)}>
        <CardContent className="space-y-2 p-4">
          <RepostHeader author={post.user} />
          <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">This post is no longer available.</div>
        </CardContent>
      </Card>
    );
  }

  const react = (clicked: ReactionType) =>
    withBusy('react', async () => {
      if (!user) return;
      const before = post;
      const next = nextReaction(shown.viewer.reaction, clicked);
      onChange(updateTarget(post, (p) => applyPostReaction(p, next)));
      try {
        const res = await socialApi.react(shown.id, clicked);
        onChange(updateTarget(before, (p) => mergeReactionResponse(applyPostReaction(p, next), res)));
      } catch (err) {
        onChange(before);
        fail('Could not save your reaction', err);
      }
    });

  const toggleSave = () =>
    withBusy('save', async () => {
      const before = post;
      const nextSaved = !shown.viewer.saved;
      onChange(updateTarget(post, (p) => ({ ...p, viewer: { ...p.viewer, saved: nextSaved } })));
      try {
        const res = (await socialApi.toggleSave(shown.id)) as { saved?: boolean } | undefined;
        const saved = typeof res?.saved === 'boolean' ? res.saved : nextSaved;
        onChange(updateTarget(before, (p) => ({ ...p, viewer: { ...p.viewer, saved } })));
        toast({ title: saved ? 'Saved' : 'Removed from saved', description: saved ? 'Find it under Saved.' : undefined });
      } catch (err) {
        onChange(before);
        fail('Could not update saved posts', err);
      }
    });

  const repost = () =>
    withBusy('repost', async () => {
      const before = post;
      onChange(updateTarget(post, (p) => ({ ...p, viewer: { ...p.viewer, reposted: true }, counts: { ...p.counts, reposts: p.counts.reposts + 1 } })));
      try {
        const created = await socialApi.repost(shown.id);
        onCreated?.(created);
        toast({ title: 'Reposted', description: 'It now appears on your profile and in your followers’ feeds.' });
      } catch (err) {
        if (getApiErrorCode(err) === 'ALREADY_REPOSTED') {
          onChange(updateTarget(before, (p) => ({ ...p, viewer: { ...p.viewer, reposted: true } })));
          return;
        }
        onChange(before);
        fail('Could not repost', err);
      }
    });

  const undoRepost = () =>
    withBusy('repost', async () => {
      const before = post;
      onChange(updateTarget(post, (p) => ({ ...p, viewer: { ...p.viewer, reposted: false }, counts: { ...p.counts, reposts: Math.max(0, p.counts.reposts - 1) } })));
      try {
        const res = (await socialApi.undoRepost(shown.id)) as { counts?: { reposts?: number } } | undefined;
        if (typeof res?.counts?.reposts === 'number') {
          const reposts = res.counts.reposts;
          onChange(updateTarget(before, (p) => ({ ...p, viewer: { ...p.viewer, reposted: false }, counts: { ...p.counts, reposts } })));
        }
        // The card itself is the viewer's own plain repost: it goes away.
        if (plain && isAuthorOfItem) onRemove?.(post.id);
        toast({ title: 'Repost removed' });
      } catch (err) {
        onChange(before);
        fail('Could not undo the repost', err);
      }
    });

  const share = () => shareLinkWithToast({ title: `${shown.user.fullName} on AITD Connection`, url: postUrl(shown.id) }, toast);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(postUrl(shown.id));
      toast({ title: 'Link copied' });
    } catch {
      toast({ variant: 'destructive', title: 'Could not copy the link' });
    }
  };

  const togglePin = () =>
    withBusy('pin', async () => {
      try {
        const updated = await socialApi.updatePost(post.id, { isPinned: !post.isPinned });
        onChange({ ...post, isPinned: updated.isPinned ?? !post.isPinned });
        toast({ title: post.isPinned ? 'Unpinned' : 'Pinned to the top of the feed' });
      } catch (err) {
        fail('Could not change the pin', err);
      }
    });

  const remove = async () => {
    try {
      await socialApi.deletePost(post.id);
      onRemove?.(post.id);
      toast({ title: 'Post deleted' });
    } catch (err) {
      fail('Could not delete the post', err);
    }
  };

  const repostable = shown.visibility === 'PUBLIC';
  const commentTarget = shown;

  return (
    <Card className={cn('shadow-sm', className)} aria-labelledby={`post-${post.id}-author`}>
      <CardContent className="space-y-3 p-4">
        {plain && <RepostHeader author={post.user} />}
        {post.isPinned && !plain && (
          <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground"><Pin className="h-3.5 w-3.5" aria-hidden="true" />Pinned</p>
        )}

        <header className="flex items-start gap-3">
          <AuthorAvatar author={(plain ? shown : post).user} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <Link id={`post-${post.id}-author`} href={`/profile/${encodeURIComponent((plain ? shown : post).user.id)}`} className="font-semibold hover:underline">
                {(plain ? shown : post).user.fullName}
              </Link>
              {(plain ? shown : post).user.membershipTier?.name && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ backgroundColor: `${(plain ? shown : post).user.membershipTier?.badgeColor ?? '#64748b'}22`, color: (plain ? shown : post).user.membershipTier?.badgeColor ?? undefined }}>
                  {(plain ? shown : post).user.membershipTier?.name}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {[(plain ? shown : post).user.currentDesignation, (plain ? shown : post).user.batchYear ? `Batch ${(plain ? shown : post).user.batchYear}` : null].filter(Boolean).join(' · ')}
            </p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Link href={`/posts/${encodeURIComponent(shown.id)}`} className="hover:underline">
                <time dateTime={shown.createdAt} title={shown.createdAt ? new Date(shown.createdAt).toLocaleString() : undefined}>{relativeTime(shown.createdAt)}</time>
              </Link>
              {shown.editedAt && <span>· Edited</span>}
              {shown.visibility === 'CONNECTIONS' && (
                <span className="flex items-center gap-0.5" title="Visible to connections"><Lock className="h-3 w-3" aria-hidden="true" /><span className="sr-only">Visible to connections</span></span>
              )}
              {shown.isReel && (
                <Link href={`/reels?start=${encodeURIComponent(shown.id)}`} className="ml-1 flex items-center gap-0.5 rounded bg-primary/10 px-1 text-[10px] font-semibold text-primary">
                  <Clapperboard className="h-3 w-3" aria-hidden="true" />Reel
                </Link>
              )}
            </p>
          </div>
          {user && !isAuthorOfShown && !shown.viewer.followsAuthor && (
            <FollowButton
              userId={shown.user.id}
              name={shown.user.fullName}
              following={false}
              hideWhenFollowing
              onChange={(following) => onChange(updateTarget(post, (p) => ({ ...p, viewer: { ...p.viewer, followsAuthor: following } })))}
            />
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Post options">
                <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={copyLink}><Link2 className="mr-2 h-4 w-4" aria-hidden="true" />Copy link</DropdownMenuItem>
              {user && (
                <DropdownMenuItem onSelect={toggleSave}>
                  {shown.viewer.saved ? <BookmarkCheck className="mr-2 h-4 w-4" aria-hidden="true" /> : <Bookmark className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {shown.viewer.saved ? 'Unsave' : 'Save'}
                </DropdownMenuItem>
              )}
              {isAuthorOfItem && !plain && (
                <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Edit</DropdownMenuItem>
              )}
              {viewerIsAdmin && !plain && (
                <DropdownMenuItem onSelect={togglePin} disabled={busy.pin}>
                  {post.isPinned ? <PinOff className="mr-2 h-4 w-4" aria-hidden="true" /> : <Pin className="mr-2 h-4 w-4" aria-hidden="true" />}
                  {post.isPinned ? 'Unpin' : 'Pin to top'}
                </DropdownMenuItem>
              )}
              {plain && isAuthorOfItem && (
                <DropdownMenuItem onSelect={undoRepost}><Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />Undo repost</DropdownMenuItem>
              )}
              {((isAuthorOfItem && !plain) || viewerIsAdmin) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive">
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Delete
                  </DropdownMenuItem>
                </>
              )}
              {user && !isAuthorOfShown && (
                <DropdownMenuItem onSelect={() => setReportOpen(true)}><Flag className="mr-2 h-4 w-4" aria-hidden="true" />Report</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {editing ? (
          <PostEditor post={post} onCancel={() => setEditing(false)} onSaved={(updated) => { onChange({ ...post, content: updated.content, mentions: updated.mentions, hashtags: updated.hashtags, visibility: updated.visibility, editedAt: updated.editedAt ?? new Date().toISOString() }); setEditing(false); }} />
        ) : (
          <PostBody post={shown} />
        )}

        {post.isRepost && !plain && <QuotedPost post={post.repostOf} />}

        {(shown.counts.reactions > 0 || shown.counts.comments > 0 || shown.counts.reposts > 0) && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <ReactionSummaryBadge topReactions={shown.topReactions} total={shown.counts.reactions} summary={shown.reactionSummary} onClick={() => setReactionsOpen(true)} />
            <div className="ml-auto flex gap-3">
              {shown.counts.comments > 0 && (
                <button type="button" className="hover:text-primary hover:underline" onClick={() => setCommentsOpen(true)}>
                  {compactCount(shown.counts.comments)} {shown.counts.comments === 1 ? 'comment' : 'comments'}
                </button>
              )}
              {shown.counts.reposts > 0 && <span>{compactCount(shown.counts.reposts)} {shown.counts.reposts === 1 ? 'repost' : 'reposts'}</span>}
              {shown.counts.views > 0 && shown.videoUrl && <span>{compactCount(shown.counts.views)} views</span>}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-1" role="group" aria-label="Post actions">
          {user ? (
            <ReactionButton reaction={shown.viewer.reaction} onReact={react} disabled={busy.react} />
          ) : (
            <Link href={`/login?next=${encodeURIComponent(`/posts/${shown.id}`)}`} className="px-3 py-2 text-sm text-muted-foreground hover:text-primary">Sign in to react</Link>
          )}
          <Button variant="ghost" size="sm" onClick={() => setCommentsOpen((o) => !o)} aria-expanded={commentsOpen} aria-label="Comment">
            <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Comment</span>
          </Button>
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" disabled={busy.repost} aria-label={shown.viewer.reposted ? 'Reposted. Repost options' : 'Repost options'} className={cn(shown.viewer.reposted && 'text-green-600')}>
                  {busy.repost ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Repeat2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  <span className="hidden sm:inline">{shown.viewer.reposted ? 'Reposted' : 'Repost'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center">
                {shown.viewer.reposted ? (
                  <DropdownMenuItem onSelect={undoRepost}><Undo2 className="mr-2 h-4 w-4" aria-hidden="true" />Undo repost</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={repost} disabled={!repostable}><Repeat2 className="mr-2 h-4 w-4" aria-hidden="true" />Repost</DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setQuoteOpen(true)} disabled={!repostable}><Quote className="mr-2 h-4 w-4" aria-hidden="true" />Quote with your thoughts</DropdownMenuItem>
                {!repostable && <p className="px-2 py-1.5 text-xs text-muted-foreground">Only public posts can be reposted.</p>}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="sm" onClick={share} aria-label="Share">
            <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" /><span className="hidden sm:inline">Share</span>
          </Button>
          {user && (
            <Button variant="ghost" size="sm" onClick={toggleSave} disabled={busy.save} aria-pressed={shown.viewer.saved} aria-label={shown.viewer.saved ? 'Unsave post' : 'Save post'} className={cn(shown.viewer.saved && 'text-primary')}>
              {shown.viewer.saved ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
            </Button>
          )}
        </div>

        {commentsOpen && (
          <CommentThread
            post={commentTarget}
            highlightId={highlightCommentId}
            autoFocus={!defaultCommentsOpen}
            onCountChange={(delta) => onChange(updateTarget(post, (p) => ({ ...p, counts: { ...p.counts, comments: Math.max(0, p.counts.comments + delta) } })))}
          />
        )}
      </CardContent>

      <ReactionsDialog postId={shown.id} open={reactionsOpen} onOpenChange={setReactionsOpen} summary={shown.reactionSummary} total={shown.counts.reactions} />
      {user && (
        <QuoteDialog
          open={quoteOpen}
          onOpenChange={setQuoteOpen}
          original={shown}
          onPosted={(created) => {
            onChange(updateTarget(post, (p) => ({ ...p, counts: { ...p.counts, reposts: p.counts.reposts + 1 } })));
            onCreated?.(created);
          }}
        />
      )}
      {user && !isAuthorOfShown && <ReportDialog open={reportOpen} onOpenChange={setReportOpen} target={{ kind: 'post', id: shown.id }} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this post?"
        description="It will be removed for everyone, including its comments and reactions."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </Card>
  );
}

function RepostHeader({ author }: { author: AuthorLite }) {
  return (
    <p className="flex items-center gap-1.5 border-b pb-2 text-xs text-muted-foreground">
      <Repeat2 className="h-3.5 w-3.5" aria-hidden="true" />
      <Link href={`/profile/${encodeURIComponent(author.id)}`} className="font-medium text-foreground hover:underline">{author.fullName}</Link>
      reposted this
    </p>
  );
}

function PostEditor({ post, onCancel, onSaved }: { post: SocialPost; onCancel: () => void; onSaved: (post: SocialPost) => void }) {
  const { toast } = useToast();
  const [text, setText] = useState(post.content);
  const [mentions, setMentions] = useState<MentionRef[]>(post.mentions);
  const [saving, setSaving] = useState(false);
  const trimmed = text.trim();
  const hasMedia = post.mediaUrls.length > 0 || Boolean(post.videoUrl) || post.isRepost;
  const can = !saving && trimmed.length <= POST_CONTENT_MAX && (trimmed.length > 0 || hasMedia);
  const save = async () => {
    if (!can) return;
    setSaving(true);
    try {
      onSaved(await socialApi.updatePost(post.id, { content: trimmed, mentionIds: activeMentionIds(text, mentions) }));
      toast({ title: 'Post updated' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save your edit', description: getApiErrorMessage(err, 'Please try again.') });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2">
      <MentionTextarea value={text} onChange={setText} mentions={mentions} onMentionsChange={setMentions} ariaLabel="Edit post" maxLength={POST_CONTENT_MAX} className="min-h-[100px]" autoFocus onSubmitShortcut={save} />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={!can}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}Save
        </Button>
      </div>
    </div>
  );
}

function QuoteDialog({ open, onOpenChange, original, onPosted }: { open: boolean; onOpenChange: (o: boolean) => void; original: SocialPost; onPosted: (post: SocialPost) => void }) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await socialApi.repost(original.id, { content: trimmed });
      onPosted(created);
      setText('');
      setMentions([]);
      onOpenChange(false);
      toast({ title: 'Shared with your thoughts' });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not share this post.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Quote post</DialogTitle>
          <DialogDescription>Add your thoughts. The original appears below your text.</DialogDescription>
        </DialogHeader>
        <MentionTextarea value={text} onChange={setText} mentions={mentions} onMentionsChange={setMentions} ariaLabel="Your thoughts" placeholder="What do you think?" maxLength={POST_CONTENT_MAX} className="min-h-[100px]" autoFocus onSubmitShortcut={submit} />
        <div className="max-h-60 overflow-y-auto"><QuotedPost post={original} /></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={!trimmed || busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}Post
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
