'use client';

import { useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { postApi, getApiErrorMessage } from '@/lib/api';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDate, getInitials } from '@/lib/utils';
import type { PostComment } from '@/types';

/** Mirrors COMMENT_CONTENT_MAX_LENGTH on the server. */
export const COMMENT_MAX_LENGTH = 2000;

/** Saves within this window of creation (clock skew, @updatedAt on insert) are not "edits". */
const EDITED_THRESHOLD_MS = 5000;

export function isCommentEdited(
  comment: Pick<PostComment, 'createdAt' | 'updatedAt'>,
  thresholdMs: number = EDITED_THRESHOLD_MS
): boolean {
  if (!comment.updatedAt) return false;
  const created = new Date(comment.createdAt).getTime();
  const updated = new Date(comment.updatedAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(updated)) return false;
  return updated - created > thresholdMs;
}

interface CommentItemProps {
  comment: PostComment;
  currentUserId?: string;
  onUpdated: (comment: PostComment) => void;
  className?: string;
}

export function CommentItem({ comment, currentUserId, onUpdated, className }: CommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorId = comment.userId ?? comment.user?.id;
  const isAuthor = !!currentUserId && currentUserId === authorId;
  const trimmed = draft.trim();
  const canSave =
    !saving && trimmed.length > 0 && trimmed.length <= COMMENT_MAX_LENGTH && trimmed !== comment.content;

  const startEdit = () => {
    setDraft(comment.content);
    setError(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(comment.content);
    setError(null);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await postApi.updateComment(comment.id, trimmed);
      const updated = (res.data?.data ?? {}) as Partial<PostComment>;
      // The PATCH response carries the author but not the reply tree; keep ours.
      onUpdated({ ...comment, ...updated, replies: comment.replies });
      setEditing(false);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not update the comment. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const name = comment.user?.fullName ?? 'Member';

  return (
    <div className={className ?? 'flex gap-3'} data-comment-id={comment.id}>
      <Avatar className="h-8 w-8">
        <AvatarImage src={comment.user?.profilePhotoUrl ?? undefined} alt={name} />
        <AvatarFallback className="text-xs">{getInitials(name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="rounded-lg bg-secondary px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold truncate">{name}</p>
            {isAuthor && !editing && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground"
                onClick={startEdit}
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
            )}
          </div>
          {editing ? (
            <div className="mt-2 space-y-2">
              <Textarea
                aria-label="Edit comment"
                className="resize-none min-h-[60px] bg-background"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={saving}
                autoFocus
              />
              {trimmed.length > COMMENT_MAX_LENGTH && (
                <p className="text-xs text-destructive">
                  Comments can be at most {COMMENT_MAX_LENGTH} characters.
                </p>
              )}
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={!canSave}>
                  {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm whitespace-pre-wrap break-words">{comment.content}</p>
          )}
        </div>
        <p className="mt-1 px-1 text-xs text-muted-foreground">
          {formatDate(comment.createdAt)}
          {isCommentEdited(comment) && <span className="ml-1">(edited)</span>}
        </p>
      </div>
    </div>
  );
}
