'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, FileQuestion, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PostCard } from '@/components/social/PostCard';
import { TrendingHashtags } from '@/components/social/Sidebar';
import { getApiErrorMessage } from '@/lib/api';
import { commentIdFromHash, socialApi, type SocialPost } from '@/lib/social';

export default function PostPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();
  const [post, setPost] = useState<SocialPost | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setHighlight(commentIdFromHash(typeof window !== 'undefined' ? window.location.hash : null));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setState('loading');
    socialApi
      .getPost(id, { signal: controller.signal })
      .then((p) => {
        setPost(p);
        setState('ready');
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 404 || status === 403) {
          setState('missing');
        } else {
          setError(getApiErrorMessage(err, 'Could not load this post.'));
          setState('error');
        }
      });
    return () => controller.abort();
  }, [id, attempt]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <Button variant="ghost" size="sm" onClick={() => (window.history.length > 1 ? router.back() : router.push('/dashboard'))}>
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />Back
        </Button>
        <h1 className="sr-only">Post</h1>
        {state === 'loading' && (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Loading post" /></div>
        )}
        {state === 'missing' && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <FileQuestion className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="text-lg font-semibold">This post isn’t available</p>
              <p className="max-w-sm text-sm text-muted-foreground">It may have been deleted, or it’s only visible to the author’s connections.</p>
              <Button asChild variant="outline"><Link href="/dashboard">Go to your feed</Link></Button>
            </CardContent>
          </Card>
        )}
        {state === 'error' && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
              <p role="alert" className="text-sm text-destructive">{error}</p>
              <Button variant="outline" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>
            </CardContent>
          </Card>
        )}
        {state === 'ready' && post && (
          <PostCard
            post={post}
            onChange={setPost}
            onRemove={() => router.push('/dashboard')}
            defaultCommentsOpen
            highlightCommentId={highlight}
          />
        )}
      </div>
      <aside className="hidden lg:block" aria-label="Discover">
        <TrendingHashtags />
      </aside>
    </div>
  );
}
