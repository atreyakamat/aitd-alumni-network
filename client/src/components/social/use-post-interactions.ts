'use client';

import { useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { shareLinkWithToast } from '@/lib/share';
import {
  applyPostReaction,
  mergeReactionResponse,
  nextReaction,
  postUrl,
  socialApi,
  type ReactionType,
  type SocialPost,
} from '@/lib/social';

/** Optimistic react / save / repost / share for a single post (used by the reels viewer). */
export function usePostInteractions(post: SocialPost, onChange: (post: SocialPost) => void) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const latest = useRef(post);
  latest.current = post;

  const run = async (key: string, fn: () => Promise<void>) => {
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

  const react = (clicked: ReactionType) =>
    run('react', async () => {
      const before = latest.current;
      const next = nextReaction(before.viewer.reaction, clicked);
      onChange(applyPostReaction(before, next));
      try {
        const res = await socialApi.react(before.id, clicked);
        onChange(mergeReactionResponse(applyPostReaction(before, next), res));
      } catch (err) {
        onChange(before);
        fail('Could not save your reaction', err);
      }
    });

  const toggleSave = () =>
    run('save', async () => {
      const before = latest.current;
      const saved = !before.viewer.saved;
      onChange({ ...before, viewer: { ...before.viewer, saved } });
      try {
        await socialApi.toggleSave(before.id);
        toast({ title: saved ? 'Saved' : 'Removed from saved' });
      } catch (err) {
        onChange(before);
        fail('Could not update saved posts', err);
      }
    });

  const toggleRepost = () =>
    run('repost', async () => {
      const before = latest.current;
      const reposting = !before.viewer.reposted;
      onChange({
        ...before,
        viewer: { ...before.viewer, reposted: reposting },
        counts: { ...before.counts, reposts: Math.max(0, before.counts.reposts + (reposting ? 1 : -1)) },
      });
      try {
        if (reposting) await socialApi.repost(before.id);
        else await socialApi.undoRepost(before.id);
        toast({ title: reposting ? 'Reposted' : 'Repost removed' });
      } catch (err) {
        if (reposting && getApiErrorCode(err) === 'ALREADY_REPOSTED') {
          onChange({ ...before, viewer: { ...before.viewer, reposted: true } });
          return;
        }
        onChange(before);
        fail(reposting ? 'Could not repost' : 'Could not undo the repost', err);
      }
    });

  const share = () =>
    shareLinkWithToast({ title: `${latest.current.user.fullName} on AIEM Connection`, url: postUrl(latest.current.id) }, toast);

  return { busy, react, toggleSave, toggleRepost, share };
}
