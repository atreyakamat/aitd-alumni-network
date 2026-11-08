'use client';

import { useCallback, useEffect, useState } from 'react';
import { PostList } from '@/components/social/Feed';
import { FollowListDialog } from '@/components/social/PeopleList';
import { FollowButton } from '@/components/social/FollowButton';
import type { FetchPage } from '@/hooks/use-cursor-list';
import { compactCount, socialApi, type SocialPost } from '@/lib/social';

const count = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

/** Follower / following / post counts (clickable lists) and, for other members, a Follow button. */
export function ProfileFollowBar({
  profile,
  userId,
  canFollow,
}: {
  profile: { followerCount?: unknown; followingCount?: unknown; postCount?: unknown; isFollowing?: unknown; fullName?: string };
  userId: string;
  canFollow: boolean;
}) {
  const [followers, setFollowers] = useState(count(profile.followerCount));
  const [following, setFollowing] = useState(profile.isFollowing === true);
  const [dialog, setDialog] = useState<'followers' | 'following' | null>(null);

  useEffect(() => {
    setFollowers(count(profile.followerCount));
    setFollowing(profile.isFollowing === true);
  }, [profile.followerCount, profile.isFollowing]);

  const followingCount = count(profile.followingCount);
  const posts = count(profile.postCount);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <button type="button" className="hover:underline" onClick={() => setDialog('followers')} aria-label={`${followers} followers. Show followers`}>
        <span className="font-semibold">{compactCount(followers)}</span> <span className="text-muted-foreground">{followers === 1 ? 'follower' : 'followers'}</span>
      </button>
      <button type="button" className="hover:underline" onClick={() => setDialog('following')} aria-label={`Following ${followingCount}. Show who they follow`}>
        <span className="font-semibold">{compactCount(followingCount)}</span> <span className="text-muted-foreground">following</span>
      </button>
      <span>
        <span className="font-semibold">{compactCount(posts)}</span> <span className="text-muted-foreground">{posts === 1 ? 'post' : 'posts'}</span>
      </span>
      {canFollow && (
        <FollowButton
          userId={userId}
          name={profile.fullName ?? 'this member'}
          following={following}
          onChange={(now, serverCount) => {
            setFollowing(now);
            setFollowers((c) => (typeof serverCount === 'number' ? serverCount : Math.max(0, c + (now ? 1 : -1))));
          }}
        />
      )}
      <FollowListDialog userId={userId} kind={dialog ?? 'followers'} open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)} />
    </div>
  );
}

/** A member's posts. */
export function ProfileActivity({ userId, name, isOwn }: { userId: string; name: string; isOwn: boolean }) {
  const fetchPage = useCallback<FetchPage<SocialPost>>(
    (cursor, signal) => socialApi.userPosts(userId, { cursor }, { signal }),
    [userId]
  );
  return (
    <section aria-label="Activity" className="space-y-4">
      <h2 className="text-lg font-semibold">Activity</h2>
      <PostList
        fetchPage={fetchPage}
        listKey={`${userId}:posts`}
        empty={{
          title: isOwn ? 'You haven’t posted yet' : `${name} hasn’t posted yet`,
          body: isOwn ? 'Share an update from your home feed.' : undefined,
        }}
      />
    </section>
  );
}
