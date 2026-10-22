'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PostList } from '@/components/social/Feed';
import type { FetchPage } from '@/hooks/use-cursor-list';
import { socialApi, targetPost, type SocialPost } from '@/lib/social';

export default function SavedPage() {
  const fetchPage = useCallback<FetchPage<SocialPost>>((cursor, signal) => socialApi.saved(cursor, { signal }), []);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <header className="flex items-center gap-3">
        <Bookmark className="h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Saved posts</h1>
          <p className="text-sm text-muted-foreground">Only you can see what you save.</p>
        </div>
      </header>
      <PostList
        fetchPage={fetchPage}
        listKey="saved"
        // Unsaving here takes the post off the list.
        keep={(post) => targetPost(post).viewer.saved}
        empty={{
          title: 'Nothing saved yet',
          body: 'Tap the bookmark on any post to keep it here for later.',
          action: <Button asChild variant="outline" size="sm"><Link href="/dashboard">Browse the feed</Link></Button>,
        }}
      />
    </div>
  );
}
