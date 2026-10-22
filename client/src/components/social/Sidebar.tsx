'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Hash, TrendingUp, UserPlus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonRow } from '@/components/social/PeopleList';
import { FollowButton } from '@/components/social/FollowButton';
import { networkApi } from '@/lib/api';
import { compactCount, normalizeAuthor, socialApi, type AuthorLite, type TrendingTag } from '@/lib/social';

/** Most-used hashtags of the last week. Renders nothing when there are none or the request fails. */
export function TrendingHashtags({ limit = 8 }: { limit?: number }) {
  const [tags, setTags] = useState<TrendingTag[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    socialApi
      .trending({ limit, signal: controller.signal })
      .then(setTags)
      .catch(() => setTags([]));
    return () => controller.abort();
  }, [limit]);

  if (tags !== null && tags.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" />Trending this week</CardTitle>
      </CardHeader>
      <CardContent>
        {tags === null ? (
          <div className="space-y-2" aria-label="Loading trending hashtags">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-5 w-2/3" />)}</div>
        ) : (
          <ol className="space-y-1">
            {tags.map((t) => (
              <li key={t.tag}>
                <Link href={`/hashtags/${encodeURIComponent(t.tag)}`} className="flex items-center justify-between rounded px-1 py-1 text-sm hover:bg-muted">
                  <span className="flex items-center gap-1 font-medium"><Hash className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />{t.tag}</span>
                  <span className="text-xs text-muted-foreground">{compactCount(t.postCount)} {t.postCount === 1 ? 'post' : 'posts'}</span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/** Alumni to follow, from the network suggestions. */
export function WhoToFollow({ limit = 4 }: { limit?: number }) {
  const [people, setPeople] = useState<AuthorLite[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    networkApi
      .getSuggestions(limit)
      .then((res) => {
        const raw = res.data?.data;
        const list = Array.isArray(raw) ? raw : Array.isArray(raw?.suggestions) ? raw.suggestions : [];
        if (!cancelled) setPeople(list.map(normalizeAuthor).filter((p: AuthorLite) => p.id));
      })
      .catch(() => !cancelled && setPeople([]));
    return () => {
      cancelled = true;
    };
  }, [limit]);

  if (people !== null && people.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><UserPlus className="h-4 w-4 text-primary" aria-hidden="true" />Who to follow</CardTitle>
      </CardHeader>
      <CardContent>
        {people === null ? (
          <div className="space-y-3" aria-label="Loading suggestions">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (
          <ul className="divide-y">
            {people.map((p) => (
              <PersonRow key={p.id} person={p} trailing={<FollowButton userId={p.id} name={p.fullName} following={false} />} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
