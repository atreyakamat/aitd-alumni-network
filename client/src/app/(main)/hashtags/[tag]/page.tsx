'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PostList } from '@/components/social/Feed';
import { TrendingHashtags } from '@/components/social/Sidebar';
import type { FetchPage } from '@/hooks/use-cursor-list';
import { compactCount, socialApi, type SocialPost } from '@/lib/social';

export default function HashtagPage() {
  const params = useParams<{ tag: string }>();
  const raw = typeof params?.tag === 'string' ? params.tag : '';
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  const tag = decoded.replace(/^#/, '').toLowerCase();
  const [postCount, setPostCount] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    socialApi
      .trending({ days: 30, limit: 50, signal: controller.signal })
      .then((tags) => setPostCount(tags.find((t) => t.tag === tag)?.postCount ?? null))
      .catch(() => setPostCount(null));
    return () => controller.abort();
  }, [tag]);

  const fetchPage = useCallback<FetchPage<SocialPost>>((cursor, signal) => socialApi.hashtagPosts(tag, cursor, { signal }), [tag]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <header className="flex items-center gap-3 rounded-lg border bg-card p-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Hash className="h-6 w-6" aria-hidden="true" /></span>
          <div>
            <h1 className="text-xl font-bold">#{tag}</h1>
            <p className="text-sm text-muted-foreground">
              {postCount !== null ? `${compactCount(postCount)} ${postCount === 1 ? 'post' : 'posts'} in the last 30 days` : 'Posts with this hashtag'}
            </p>
          </div>
        </header>
        <PostList
          fetchPage={fetchPage}
          listKey={tag}
          enabled={tag.length > 0}
          empty={{
            title: `No posts with #${tag} yet`,
            body: 'Use the hashtag in a post to start the conversation.',
            action: <Button asChild variant="outline" size="sm"><Link href="/dashboard">Write a post</Link></Button>,
          }}
        />
      </div>
      <aside className="hidden lg:block" aria-label="Trending hashtags">
        <TrendingHashtags />
      </aside>
    </div>
  );
}
