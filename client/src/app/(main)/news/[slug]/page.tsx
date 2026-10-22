'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ChevronLeft, Clock, Eye, Newspaper } from 'lucide-react';
import { getApiErrorMessage, newsApi } from '@/lib/api';
import { NEWS_CATEGORY_COLORS, contentToParagraphs, newsCategoryLabel } from '@/lib/news';
import { formatDate, getInitials } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { NewsArticle } from '@/types';

const isNotFound = (err: unknown) => (err as any)?.response?.status === 404;

function ArticleSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6" role="status" aria-label="Loading article">
      <Skeleton className="h-9 w-32" />
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Button asChild variant="ghost" className="mb-2">
      <Link href="/news">
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to News
      </Link>
    </Button>
  );
}

/**
 * Public article page (GET /news/:slug is optionalAuth). Works for anonymous
 * viewers: only public endpoints are called.
 */
export default function NewsArticlePage() {
  const params = useParams();
  const slug = (params?.slug as string) ?? '';

  const articleQuery = useQuery({
    queryKey: ['news', 'article', slug],
    enabled: !!slug,
    retry: (count, err) => !isNotFound(err) && count < 1,
    // Each fetch counts a view server-side; don't refetch on focus.
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<NewsArticle> => (await newsApi.getArticle(slug)).data.data,
  });

  const latestQuery = useQuery({
    queryKey: ['news', 'latest', 5],
    enabled: articleQuery.isSuccess,
    queryFn: async (): Promise<NewsArticle[]> => {
      const body = (await newsApi.getLatest(5)).data;
      const list = body?.data ?? body;
      return Array.isArray(list) ? list : [];
    },
  });

  if (articleQuery.isLoading) return <ArticleSkeleton />;

  if (articleQuery.isError || !articleQuery.data) {
    const notFound = isNotFound(articleQuery.error);
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        {notFound ? (
          <Newspaper className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-40" aria-hidden="true" />
        ) : (
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" aria-hidden="true" />
        )}
        <h1 className="text-2xl font-bold mb-2">{notFound ? 'Article not found' : 'Something went wrong'}</h1>
        <p className="text-muted-foreground mb-6">
          {notFound
            ? 'This article does not exist or is no longer published.'
            : getApiErrorMessage(articleQuery.error, 'Failed to load this article.')}
        </p>
        <div className="flex justify-center gap-2">
          {!notFound && (
            <Button variant="outline" onClick={() => articleQuery.refetch()}>
              Retry
            </Button>
          )}
          <Button asChild>
            <Link href="/news">Back to News</Link>
          </Button>
        </div>
      </div>
    );
  }

  const article = articleQuery.data;
  const paragraphs = contentToParagraphs(article.content);
  const related = (latestQuery.data ?? []).filter((a) => a.id !== article.id).slice(0, 4);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <BackLink />

      <div className="grid lg:grid-cols-3 gap-6">
        <article className="lg:col-span-2 space-y-6">
          <header className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={NEWS_CATEGORY_COLORS[article.category] ?? 'bg-gray-100 text-gray-700'}>
                {newsCategoryLabel(article.category)}
              </Badge>
              {article.status && article.status !== 'PUBLISHED' && (
                <Badge variant="outline">{article.status === 'DRAFT' ? 'Draft preview' : article.status}</Badge>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-[#002045] leading-tight">{article.title}</h1>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {article.author && (
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    {article.author.profilePhotoUrl && <AvatarImage src={article.author.profilePhotoUrl} alt="" />}
                    <AvatarFallback className="text-xs">{getInitials(article.author.fullName)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-medium text-foreground">{article.author.fullName}</p>
                    {article.author.currentDesignation && <p className="text-xs">{article.author.currentDesignation}</p>}
                  </div>
                </div>
              )}
              {(article.publishedAt || article.createdAt) && (
                <time dateTime={article.publishedAt ?? article.createdAt}>
                  {formatDate(article.publishedAt ?? article.createdAt)}
                </time>
              )}
              {article.readingTime ? (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {article.readingTime} min read
                </span>
              ) : null}
              <span className="flex items-center gap-1">
                <Eye className="h-4 w-4" aria-hidden="true" />
                {article.viewCount ?? 0} views
              </span>
            </div>
          </header>

          {article.featuredImage && (
            <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
              <Image src={article.featuredImage} alt="" fill className="object-cover" unoptimized priority />
            </div>
          )}

          {/* Content is rendered as escaped plain text; admin HTML is stripped, never injected. */}
          <div className="space-y-4 text-base leading-relaxed text-foreground/90" data-testid="article-body">
            {paragraphs.length === 0 ? (
              <p className="text-muted-foreground">This article has no content yet.</p>
            ) : (
              paragraphs.map((p, i) => (
                <p key={i} className="whitespace-pre-line">
                  {p}
                </p>
              ))
            )}
          </div>
        </article>

        <aside>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Latest news</CardTitle>
            </CardHeader>
            <CardContent>
              {latestQuery.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : related.length === 0 ? (
                <p className="text-sm text-muted-foreground">No other articles yet.</p>
              ) : (
                <ul className="space-y-4">
                  {related.map((a) => (
                    <li key={a.id}>
                      <Link href={`/news/${encodeURIComponent(a.slug || a.id)}`} className="group block">
                        <p className="text-sm font-medium group-hover:underline line-clamp-2">{a.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {newsCategoryLabel(a.category)}
                          {a.publishedAt ? ` · ${formatDate(a.publishedAt)}` : ''}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Button asChild variant="outline" size="sm" className="w-full mt-4">
                <Link href="/news">All news</Link>
              </Button>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
