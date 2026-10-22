'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send } from 'lucide-react';
import { postApi, getApiErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CommentItem, COMMENT_MAX_LENGTH } from '@/components/posts/CommentItem';
import type { PostComment } from '@/types';

/** Replace a comment (top-level or reply) by id, leaving the rest of the tree intact. */
export function replaceComment(comments: PostComment[], updated: PostComment): PostComment[] {
  return comments.map((c) => {
    if (c.id === updated.id) return updated;
    if (c.replies?.length) return { ...c, replies: replaceComment(c.replies, updated) };
    return c;
  });
}

interface PostCommentsProps {
  postId: string;
  currentUserId?: string;
  onCommentAdded?: () => void;
}

export function PostComments({ postId, currentUserId, onCommentAdded }: PostCommentsProps) {
  const [comments, setComments] = useState<PostComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    postApi
      .getPost(postId)
      .then((res) => {
        if (!cancelled) setComments((res.data?.data?.comments as PostComment[]) ?? []);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(getApiErrorMessage(err, 'Could not load comments.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postId]);

  const handleUpdated = useCallback((updated: PostComment) => {
    setComments((prev) => replaceComment(prev, updated));
  }, []);

  const trimmed = draft.trim();
  const canPost = !posting && trimmed.length > 0 && trimmed.length <= COMMENT_MAX_LENGTH;

  const addComment = async () => {
    if (!canPost) return;
    setPosting(true);
    setPostError(null);
    try {
      const res = await postApi.addComment(postId, trimmed);
      const created = res.data?.data as PostComment;
      // The feed lists newest first, matching the server's ordering.
      setComments((prev) => [{ ...created, replies: created.replies ?? [] }, ...prev]);
      setDraft('');
      onCommentAdded?.();
    } catch (err) {
      setPostError(getApiErrorMessage(err, 'Could not post your comment. Please try again.'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mt-3 space-y-4">
      {currentUserId && (
        <div className="space-y-2">
          <Textarea
            aria-label="Write a comment"
            placeholder="Write a comment..."
            className="resize-none min-h-[60px]"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={posting}
          />
          {postError && (
            <p role="alert" className="text-xs text-destructive">
              {postError}
            </p>
          )}
          <div className="flex justify-end">
            <Button size="sm" onClick={addComment} disabled={!canPost}>
              {posting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Comment
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-label="Loading comments" />
        </div>
      ) : loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {loadError}
        </p>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="space-y-3">
              <CommentItem comment={comment} currentUserId={currentUserId} onUpdated={handleUpdated} />
              {comment.replies && comment.replies.length > 0 && (
                <ul className="ml-11 space-y-3">
                  {comment.replies.map((reply) => (
                    <li key={reply.id}>
                      <CommentItem comment={reply} currentUserId={currentUserId} onUpdated={handleUpdated} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
