'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clapperboard, MessageSquareText } from 'lucide-react';
import { PostList } from '@/components/social/Feed';
import { FollowListDialog } from '@/components/social/PeopleList';
import { FollowButton } from '@/components/social/FollowButton';
import type { FetchPage } from '@/hooks/use-cursor-list';
import { compactCount, socialApi, type SocialPost } from '@/lib/social';
import { cn } from '@/lib/utils';

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

/** A member's posts and reels. */
export function ProfileActivity({ userId, name, isOwn }: { userId: string; name: string; isOwn: boolean }) {
  const [tab, setTab] = useState<'posts' | 'reels'>('posts');
  const fetchPage = useCallback<FetchPage<SocialPost>>(
    (cursor, signal) => socialApi.userPosts(userId, { cursor, reels: tab === 'reels' }, { signal }),
    [userId, tab]
  );
  const tabs = [
    { key: 'posts' as const, label: 'Posts', icon: MessageSquareText },
    { key: 'reels' as const, label: 'Reels', icon: Clapperboard },
  ];
  return (
    <section aria-label="Activity" className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Activity</h2>
        <div role="tablist" aria-label="Activity" className="flex gap-1 rounded-lg border bg-card p-1">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn('flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium', tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      </div>
      <PostList
        fetchPage={fetchPage}
        listKey={`${userId}:${tab}`}
        empty={
          tab === 'reels'
            ? { title: isOwn ? 'You haven’t posted a reel yet' : `${name} hasn’t posted a reel yet` }
            : { title: isOwn ? 'You haven’t posted yet' : `${name} hasn’t posted yet`, body: isOwn ? 'Share an update from your home feed.' : undefined }
        }
      />
    </section>
  );
}
