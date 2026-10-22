'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { socialApi } from '@/lib/social';
import { cn } from '@/lib/utils';

/** Optimistic follow/unfollow toggle. `onChange` receives the new state and the server's follower count. */
export function FollowButton({
  userId,
  name,
  following: initial,
  onChange,
  size = 'sm',
  className,
  hideWhenFollowing = false,
}: {
  userId: string;
  name: string;
  following: boolean;
  onChange?: (following: boolean, followerCount?: number) => void;
  size?: 'sm' | 'default';
  className?: string;
  /** For "follow" chips on post headers: disappear once followed. */
  hideWhenFollowing?: boolean;
}) {
  const { toast } = useToast();
  const [following, setFollowing] = useState(initial);
  const [pending, setPending] = useState(false);
  const [justFollowed, setJustFollowed] = useState(false);

  useEffect(() => setFollowing(initial), [initial]);

  if (hideWhenFollowing && following && !justFollowed) return null;

  const toggle = async () => {
    if (pending) return;
    const next = !following;
    setFollowing(next);
    setPending(true);
    try {
      const res = (next ? await socialApi.follow(userId) : await socialApi.unfollow(userId)) as
        | { following?: boolean; followerCount?: number }
        | undefined;
      const confirmed = typeof res?.following === 'boolean' ? res.following : next;
      setFollowing(confirmed);
      if (confirmed) setJustFollowed(true);
      onChange?.(confirmed, typeof res?.followerCount === 'number' ? res.followerCount : undefined);
    } catch (err) {
      setFollowing(!next);
      toast({
        variant: 'destructive',
        title: next ? `Could not follow ${name}` : `Could not unfollow ${name}`,
        description: getApiErrorMessage(err, 'Please try again.'),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={following ? 'outline' : 'default'}
      onClick={toggle}
      disabled={pending}
      aria-pressed={following}
      aria-label={following ? `Unfollow ${name}` : `Follow ${name}`}
      className={cn(size === 'sm' && 'h-8', className)}
    >
      {pending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : following ? (
        <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <UserPlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
      )}
      {following ? 'Following' : 'Follow'}
    </Button>
  );
}
