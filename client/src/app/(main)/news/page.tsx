'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Clock, Eye, Newspaper, Search, User } from 'lucide-react';
import { getApiErrorMessage, newsApi, readPaginated } from '@/lib/api';
import { NEWS_CATEGORIES, NEWS_CATEGORY_COLORS, newsCategoryLabel, newsExcerpt } from '@/lib/news';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { formatDate } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { NewsArticle } from '@/types';

const ALL = 'ALL';
const PAGE_SIZE = 12;
const SEARCH_DEBOUNCE_MS = 300;

const articleHref = (article: Pick<NewsArticle, 'slug' | 'id'>) => `/news/${encodeURIComponent(article.slug || article.id)}`;

function Cover({ article, large }: { article: NewsArticle; large?: boolean }) {
  if (article.featuredImage) {
    return (
      <div className={`relative ${large ? 'aspect-video md:aspect-auto md:min-h-[280px]' : 'aspect-video'} bg-muted`}>
        <Image src={article.featuredImage} alt="" fill className="object-cover" unoptimized />
      </div>
    );
  }
  return (
    <div
      className={`${large ? 'aspect-video md:aspect-auto md:min-h-[280px]' : 'aspect-video'} bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center`}
    >
      <Newspaper className={`${large ? 'h-16 w-16' : 'h-10 w-10'} text-primary/40`} aria-hidden="true" />
    </div>
  );
}

function NewsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading articles">
      <Card className="overflow-hidden">
        <div className="grid md:grid-cols-2">
          <Skeleton className="aspect-video md:aspect-auto md:min-h-[280px] rounded-none" />
          <div className="p-6 space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      </Card>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <Card key={i} className="overflow-hidden">
            <Skeleton className="aspect-video rounded-none" />
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function NewsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const search = useDebouncedValue(searchQuery.trim(), SEARCH_DEBOUNCE_MS);
  // The page belongs to one search term: a new term starts again at page 1
  // without an extra request for the old page.
  const [pager, setPager] = useState({ search: '', page: 1 });
  const page = pager.search === search ? pager.page : 1;
  const setPage = (next: number | ((current: number) => number)) =>
    setPager({ search, page: typeof next === 'function' ? next(page) : next });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['news', 'list', category, search, page],
    queryFn: async () =>
      (
        await newsApi.getArticles({
          page,
          limit: PAGE_SIZE,
          category: category === ALL ? undefined : category,
          search: search || undefined,
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  const { items, totalPages } = readPaginated<NewsArticle>(data);
  const [featured, ...others] = items;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">News & Stories</h1>
          <p className="text-muted-foreground">Stay updated with alumni achievements and institute news</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Search articles"
                placeholder="Search articles..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={category}
              onValueChange={(val) => {
                setCategory(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full md:w-[200px]" aria-label="Filter by category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {NEWS_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <NewsSkeleton />
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span>{getApiErrorMessage(error, 'Failed to load news. Please try again later.')}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : !featured ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Newspaper className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-20" aria-hidden="true" />
          <h3 className="text-lg font-medium">No articles found</h3>
          <p className="text-muted-foreground">
            {searchQuery || category !== ALL ? 'Try adjusting your search or category.' : 'Check back soon for news and stories.'}
          </p>
        </div>
      ) : (
        <>
          <Card className="overflow-hidden hover:shadow-lg transition-shadow">
            <div className="grid md:grid-cols-2 gap-0">
              <Cover article={featured} large />
              <CardContent className="p-6 flex flex-col justify-center">
                <Badge className={`w-fit mb-3 ${NEWS_CATEGORY_COLORS[featured.category] ?? 'bg-gray-100 text-gray-700'}`}>
                  {newsCategoryLabel(featured.category)}
                </Badge>
                <h2 className="text-2xl font-bold mb-3">{featured.title}</h2>
                <p className="text-muted-foreground mb-4">{newsExcerpt(featured)}</p>
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-4">
                  {featured.author?.fullName && (
                    <div className="flex items-center gap-1">
                      <User className="h-4 w-4" aria-hidden="true" />
                      <span>{featured.author.fullName}</span>
                    </div>
                  )}
                  {featured.publishedAt && (
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      <span>{formatDate(featured.publishedAt)}</span>
                    </div>
                  )}
                  {featured.readingTime ? <span>{featured.readingTime} min read</span> : null}
                </div>
                <Button asChild className="w-fit">
                  <Link href={articleHref(featured)}>
                    Read Full Story
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </div>
          </Card>

          {others.length > 0 && (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {others.map((article) => (
                <Card key={article.id} className="overflow-hidden hover:shadow-md transition-shadow flex flex-col">
                  <Cover article={article} />
                  <CardContent className="p-6 flex flex-col flex-1">
                    <Badge className={`w-fit mb-3 ${NEWS_CATEGORY_COLORS[article.category] ?? 'bg-gray-100 text-gray-700'}`}>
                      {newsCategoryLabel(article.category)}
                    </Badge>
                    <h3 className="font-semibold text-lg mb-2 line-clamp-2">{article.title}</h3>
                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2 flex-1">{newsExcerpt(article)}</p>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span>{article.publishedAt ? formatDate(article.publishedAt) : ''}</span>
                      <span className="flex items-center gap-1">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        {article.viewCount ?? 0} views
                      </span>
                    </div>
                    <Button asChild variant="outline" className="w-full mt-4">
                      <Link href={articleHref(article)} aria-label={`Read more: ${article.title}`}>
                        Read More
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {!isLoading && !isError && totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <div className="flex items-center px-4 text-sm font-medium">
            Page {page} of {totalPages}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
