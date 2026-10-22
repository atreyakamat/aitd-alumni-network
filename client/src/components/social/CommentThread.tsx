'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Flag, Loader2, MoreHorizontal, Pencil, Reply, Send, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/social/ConfirmDialog';
import { MentionTextarea } from '@/components/social/MentionTextarea';
import { ReactionButton } from '@/components/social/ReactionButton';
import { ReportDialog } from '@/components/social/ReportDialog';
import { RichText } from '@/components/social/RichText';
import { useAuth } from '@/context/auth-context';
import { appendUnique, useCursorList } from '@/hooks/use-cursor-list';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { isAdmin } from '@/lib/roles';
import {
  COMMENT_CONTENT_MAX,
  activeMentionIds,
  applyCommentReaction,
  compactCount,
  mediaSrc,
  nextReaction,
  relativeTime,
  socialApi,
  type MentionRef,
  type ReactionType,
  type SocialComment,
  type SocialPost,
} from '@/lib/social';
import { cn, getInitials } from '@/lib/utils';

/** Replies are one level deep: replying to a reply attaches to its top-level comment. */
export const replyParentId = (comment: Pick<SocialComment, 'id' | 'parentId'>): string => comment.parentId ?? comment.id;

interface ReplyState {
  items: SocialComment[];
  cursor: string | null;
  /** True once replies were fetched from /comments/:id/replies (preview replies don't count). */
  fetched: boolean;
  loading: boolean;
}

type Sort = 'top' | 'newest';

export function CommentThread({
  post,
  onCountChange,
  highlightId,
  autoFocus = false,
  className,
}: {
  /** The post the comments belong to (for a plain repost, pass the original). */
  post: Pick<SocialPost, 'id' | 'user' | 'counts'>;
  onCountChange?: (delta: number) => void;
  highlightId?: string | null;
  autoFocus?: boolean;
  className?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [sort, setSort] = useState<Sort>('top');
  const fetchPage = useCallback(
    (cursor: string | null, signal: AbortSignal) => socialApi.comments(post.id, { sort, cursor }, { signal }),
    [post.id, sort]
  );
  const list = useCursorList<SocialComment>(fetchPage, `${post.id}:${sort}`, (c) => c.id);
  const [replies, setReplies] = useState<Record<string, ReplyState>>({});
  const [replyTo, setReplyTo] = useState<{ parentId: string; prefill: MentionRef | null } | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const scrolledTo = useRef<string | null>(null);

  // Seed reply state from each comment's preview replies.
  useEffect(() => {
    setReplies((prev) => {
      const next = { ...prev };
      for (const c of list.items) {
        if (!next[c.id]) next[c.id] = { items: c.previewReplies, cursor: null, fetched: false, loading: false };
      }
      return next;
    });
  }, [list.items]);

  // Deep link: /posts/<id>#comment-<cid> scrolls to and highlights the comment once it is rendered.
  useEffect(() => {
    if (!highlightId || scrolledTo.current === highlightId) return;
    const el = typeof document !== 'undefined' ? document.getElementById(`comment-${highlightId}`) : null;
    if (!el) return;
    scrolledTo.current = highlightId;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlighted(highlightId);
    const t = window.setTimeout(() => setHighlighted(null), 2500);
    return () => window.clearTimeout(t);
  }, [highlightId, list.items, replies]);

  const loadReplies = async (commentId: string) => {
    const state = replies[commentId];
    if (state?.loading) return;
    setReplies((p) => ({ ...p, [commentId]: { ...(p[commentId] ?? { items: [], cursor: null, fetched: false }), loading: true } }));
    try {
      const page = await socialApi.replies(commentId, state?.fetched ? state.cursor : null);
      setReplies((p) => {
        const cur = p[commentId] ?? { items: [], cursor: null, fetched: false, loading: false };
        return { ...p, [commentId]: { items: appendUnique(cur.items, page.items, (c) => c.id), cursor: page.nextCursor, fetched: true, loading: false } };
      });
    } catch (err) {
      setReplies((p) => ({ ...p, [commentId]: { ...p[commentId], loading: false } }));
      toast({ variant: 'destructive', title: 'Could not load replies', description: getApiErrorMessage(err, 'Please try again.') });
    }
  };

  const updateComment = (id: string, fn: (c: SocialComment) => SocialComment) => {
    list.update(id, fn);
    setReplies((p) => {
      const next: Record<string, ReplyState> = {};
      for (const [k, v] of Object.entries(p)) next[k] = { ...v, items: v.items.map((c) => (c.id === id ? fn(c) : c)) };
      return next;
    });
  };

  const removeComment = (comment: SocialComment) => {
    if (comment.parentId) {
      setReplies((p) => {
        const cur = p[comment.parentId as string];
        return cur ? { ...p, [comment.parentId as string]: { ...cur, items: cur.items.filter((c) => c.id !== comment.id) } } : p;
      });
      list.update(comment.parentId, (c) => ({ ...c, replyCount: Math.max(0, c.replyCount - 1) }));
      onCountChange?.(-1);
    } else {
      list.remove(comment.id);
      onCountChange?.(-(1 + comment.replyCount));
    }
  };

  const added = (comment: SocialComment) => {
    if (comment.parentId) {
      setReplies((p) => {
        const cur = p[comment.parentId as string] ?? { items: [], cursor: null, fetched: false, loading: false };
        return { ...p, [comment.parentId as string]: { ...cur, items: appendUnique(cur.items, [comment], (c) => c.id) } };
      });
      list.update(comment.parentId, (c) => ({ ...c, replyCount: c.replyCount + 1 }));
      setReplyTo(null);
    } else {
      list.prepend(comment);
    }
    onCountChange?.(1);
  };

  return (
    <section className={cn('space-y-4', className)} aria-label="Comments">
      {user && <CommentComposer postId={post.id} onAdded={added} autoFocus={autoFocus} />}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Comments</h3>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded bg-transparent py-0.5 text-xs font-medium text-foreground focus:outline-none" aria-label="Sort comments">
            <option value="top">Top</option>
            <option value="newest">Newest</option>
          </select>
        </label>
      </div>

      {list.loading ? (
        <div className="flex justify-center py-3"><Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading comments" /></div>
      ) : list.error ? (
        <div className="text-sm">
          <p role="alert" className="text-destructive">{list.error}</p>
          <Button variant="link" className="h-auto p-0" onClick={list.reload}>Try again</Button>
        </div>
      ) : list.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet{user ? ' — start the conversation.' : '.'}</p>
      ) : (
        <ul className="space-y-4">
          {list.items.map((comment) => {
            const rs = replies[comment.id];
            const shown = rs?.items ?? comment.previewReplies;
            const hidden = Math.max(0, comment.replyCount - shown.length);
            return (
              <li key={comment.id} className="space-y-3">
                <CommentRow
                  comment={comment}
                  postAuthorId={post.user.id}
                  highlighted={highlighted === comment.id}
                  onChange={(c) => updateComment(comment.id, () => c)}
                  onRemoved={() => removeComment(comment)}
                  onReply={() => setReplyTo({ parentId: comment.id, prefill: null })}
                />
                {(shown.length > 0 || hidden > 0 || replyTo?.parentId === comment.id) && (
                  <ul className="ml-11 space-y-3 border-l pl-3">
                    {shown.map((reply) => (
                      <li key={reply.id}>
                        <CommentRow
                          comment={reply}
                          postAuthorId={post.user.id}
                          highlighted={highlighted === reply.id}
                          onChange={(c) => updateComment(reply.id, () => c)}
                          onRemoved={() => removeComment(reply)}
                          onReply={() => setReplyTo({ parentId: replyParentId(reply), prefill: { id: reply.user.id, fullName: reply.user.fullName } })}
                        />
                      </li>
                    ))}
                    {(hidden > 0 || (rs?.fetched && rs.cursor)) && (
                      <li>
                        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => loadReplies(comment.id)} disabled={rs?.loading}>
                          {rs?.loading && <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />}
                          {hidden > 0 ? `View ${hidden} more ${hidden === 1 ? 'reply' : 'replies'}` : 'View more replies'}
                        </Button>
                      </li>
                    )}
                    {user && replyTo?.parentId === comment.id && (
                      <li>
                        <CommentComposer
                          key={`${comment.id}:${replyTo.prefill?.id ?? ''}`}
                          postId={post.id}
                          parentId={comment.id}
                          prefill={replyTo.prefill}
                          autoFocus
                          onAdded={added}
                          onCancel={() => setReplyTo(null)}
                        />
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {list.hasMore && !list.loading && (
        <Button variant="ghost" size="sm" className="w-full" onClick={list.loadMore} disabled={list.loadingMore}>
          {list.loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Load more comments
        </Button>
      )}
    </section>
  );
}

function CommentComposer({
  postId,
  parentId,
  prefill,
  autoFocus,
  onAdded,
  onCancel,
}: {
  postId: string;
  parentId?: string;
  prefill?: MentionRef | null;
  autoFocus?: boolean;
  onAdded: (comment: SocialComment) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(prefill ? `@${prefill.fullName} ` : '');
  const [mentions, setMentions] = useState<MentionRef[]>(prefill ? [prefill] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const can = !busy && trimmed.length > 0 && trimmed.length <= COMMENT_CONTENT_MAX;

  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    try {
      const comment = await socialApi.addComment(postId, {
        content: trimmed,
        ...(parentId ? { parentId } : {}),
        mentionIds: activeMentionIds(text, mentions),
      });
      onAdded(comment);
      setText('');
      setMentions([]);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not post your comment. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <MentionTextarea
        value={text}
        onChange={setText}
        mentions={mentions}
        onMentionsChange={setMentions}
        ariaLabel={parentId ? 'Write a reply' : 'Write a comment'}
        placeholder={parentId ? 'Write a reply…' : 'Add a comment…'}
        maxLength={COMMENT_CONTENT_MAX}
        className="min-h-[44px] text-sm"
        autoFocus={autoFocus}
        disabled={busy}
        onSubmitShortcut={submit}
      />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        )}
        <Button size="sm" onClick={submit} disabled={!can}>
          {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
          {parentId ? 'Reply' : 'Comment'}
        </Button>
      </div>
    </div>
  );
}

function CommentRow({
  comment,
  postAuthorId,
  highlighted,
  onChange,
  onRemoved,
  onReply,
}: {
  comment: SocialComment;
  postAuthorId: string;
  highlighted: boolean;
  onChange: (c: SocialComment) => void;
  onRemoved: () => void;
  onReply: () => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [draftMentions, setDraftMentions] = useState<MentionRef[]>(comment.mentions);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reactBusy, setReactBusy] = useState(false);

  const isAuthor = comment.viewer.isAuthor || (!!user && comment.user.id === user.id);
  const canDelete = isAuthor || (!!user && user.id === postAuthorId) || isAdmin(user);
  const canReport = !!user && !isAuthor;

  const react = async (clicked: ReactionType) => {
    if (reactBusy || !user) return;
    const before = comment;
    const next = nextReaction(comment.viewer.reaction, clicked);
    onChange(applyCommentReaction(comment, next));
    setReactBusy(true);
    try {
      const res = (await socialApi.reactComment(comment.id, clicked)) as { reaction?: ReactionType | null; likeCount?: number } | undefined;
      if (res && ('reaction' in res || 'likeCount' in res)) {
        onChange({
          ...applyCommentReaction(before, next),
          likeCount: typeof res.likeCount === 'number' ? res.likeCount : applyCommentReaction(before, next).likeCount,
          viewer: { ...before.viewer, reaction: res.reaction === undefined ? next : res.reaction },
        });
      }
    } catch (err) {
      onChange(before);
      toast({ variant: 'destructive', title: 'Could not react', description: getApiErrorMessage(err, 'Please try again.') });
    } finally {
      setReactBusy(false);
    }
  };

  const save = async () => {
    const text = draft.trim();
    if (!text || text.length > COMMENT_CONTENT_MAX) return;
    setSaving(true);
    try {
      const updated = await socialApi.updateComment(comment.id, { content: text, mentionIds: activeMentionIds(draft, draftMentions) });
      onChange({ ...comment, ...updated, previewReplies: comment.previewReplies, replyCount: comment.replyCount, viewer: comment.viewer, editedAt: updated.editedAt ?? new Date().toISOString() });
      setEditing(false);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not save your edit', description: getApiErrorMessage(err, 'Please try again.') });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    try {
      await socialApi.deleteComment(comment.id);
      onRemoved();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not delete the comment', description: getApiErrorMessage(err, 'Please try again.') });
    }
  };

  return (
    <div id={`comment-${comment.id}`} className={cn('flex gap-3 rounded-md transition-colors', highlighted && 'bg-primary/10 ring-2 ring-primary/40')}>
      <Link href={`/profile/${encodeURIComponent(comment.user.id)}`} className="shrink-0" aria-label={`${comment.user.fullName}'s profile`}>
        <Avatar className="h-8 w-8">
          <AvatarImage src={mediaSrc(comment.user.profilePhotoUrl) || undefined} alt="" />
          <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{getInitials(comment.user.fullName)}</AvatarFallback>
        </Avatar>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="rounded-lg bg-muted/60 px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/profile/${encodeURIComponent(comment.user.id)}`} className="text-sm font-semibold hover:underline">
                {comment.user.fullName}
              </Link>
              {comment.user.id === postAuthorId && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-medium text-primary">Author</span>}
              {comment.user.currentDesignation && <p className="truncate text-xs text-muted-foreground">{comment.user.currentDesignation}</p>}
            </div>
            {(isAuthor || canDelete || canReport) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="rounded p-1 text-muted-foreground hover:bg-background" aria-label="Comment options">
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {isAuthor && (
                    <DropdownMenuItem onSelect={() => { setDraft(comment.content); setDraftMentions(comment.mentions); setEditing(true); }}>
                      <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />Edit
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-destructive focus:text-destructive">
                      <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />Delete
                    </DropdownMenuItem>
                  )}
                  {canReport && (
                    <DropdownMenuItem onSelect={() => setReporting(true)}>
                      <Flag className="mr-2 h-4 w-4" aria-hidden="true" />Report
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {editing ? (
            <div className="mt-2 space-y-2">
              <MentionTextarea value={draft} onChange={setDraft} mentions={draftMentions} onMentionsChange={setDraftMentions} ariaLabel="Edit comment" maxLength={COMMENT_CONTENT_MAX} className="min-h-[60px] bg-background text-sm" autoFocus onSubmitShortcut={save} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                <Button size="sm" onClick={save} disabled={saving || !draft.trim()}>
                  {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Save
                </Button>
              </div>
            </div>
          ) : (
            <RichText text={comment.content} mentions={comment.mentions} className="mt-1" />
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 pl-1 text-xs text-muted-foreground">
          <time dateTime={comment.createdAt} title={comment.createdAt ? new Date(comment.createdAt).toLocaleString() : undefined}>
            {relativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && <span>· Edited</span>}
          {user && (
            <>
              <ReactionButton reaction={comment.viewer.reaction} onReact={react} disabled={reactBusy} size="sm" label="comment" />
              {comment.likeCount > 0 && <span aria-label={`${comment.likeCount} reactions`}>{compactCount(comment.likeCount)}</span>}
              <button type="button" onClick={onReply} className="flex items-center gap-1 rounded px-1.5 py-1 font-medium hover:bg-muted" aria-label={`Reply to ${comment.user.fullName}`}>
                <Reply className="h-3.5 w-3.5" aria-hidden="true" />Reply
              </button>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this comment?" description={comment.parentId ? undefined : 'Replies to it will be removed too.'} confirmLabel="Delete" destructive onConfirm={remove} />
      {canReport && <ReportDialog open={reporting} onOpenChange={setReporting} target={{ kind: 'comment', id: comment.id }} />}
    </div>
  );
}
