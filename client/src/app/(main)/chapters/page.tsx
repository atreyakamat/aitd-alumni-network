'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, Loader2, MapPin, Plus, Search, UserRound, Users } from 'lucide-react';
import { chapterApi, getApiErrorMessage, readPaginated } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { isAdmin } from '@/lib/roles';
import { ALL_REGIONS, chapterMemberCount, chapterRegions } from '@/lib/chapters';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useChapterMembership } from '@/components/chapters/useChapterMembership';
import { ChapterFormDialog } from '@/components/chapters/ChapterFormDialog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getInitials } from '@/lib/utils';
import type { Chapter } from '@/types';

/** Search and region filtering happen on the server. */
const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

function ChapterCardSkeleton() {
  return (
    <Card data-testid="chapter-skeleton">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}

export default function ChaptersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const membership = useChapterMembership();
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState(ALL_REGIONS);
  const [createOpen, setCreateOpen] = useState(false);
  const canCreate = isAdmin(user);

  const term = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);
  const regionFilter = region === ALL_REGIONS ? undefined : region;
  // The page belongs to one filter combination; changing filters starts at page 1.
  const filterKey = `${term}|${region}`;
  const [pager, setPager] = useState({ key: filterKey, page: 1 });
  const page = pager.key === filterKey ? pager.page : 1;
  const setPage = (next: (current: number) => number) => setPager({ key: filterKey, page: next(page) });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['chapters', 'list', term, regionFilter ?? '', page],
    queryFn: async () =>
      (await chapterApi.getChapters(page, PAGE_SIZE, { search: term || undefined, region: regionFilter })).data,
    placeholderData: keepPreviousData,
  });

  const { items: visible, totalPages } = readPaginated<Chapter>(data);
  const serverRegions = (data as { regions?: unknown } | undefined)?.regions;
  const regions = useMemo(() => {
    const list = Array.isArray(serverRegions)
      ? serverRegions.filter((r): r is string => typeof r === 'string' && r.trim() !== '')
      : chapterRegions(visible);
    // Keep the active choice selectable even if the list no longer contains it.
    return regionFilter && !list.includes(regionFilter) ? [...list, regionFilter] : list;
  }, [serverRegions, visible, regionFilter]);
  const filtersActive = !!term || region !== ALL_REGIONS;

  const createChapter = async (payload: Parameters<typeof chapterApi.createChapter>[0]) => {
    await chapterApi.createChapter(payload);
    toast({ title: 'Chapter created', description: `"${payload.name}" is now live.` });
    queryClient.invalidateQueries({ queryKey: ['chapters'] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#002045]">Alumni Chapters</h1>
          <p className="text-muted-foreground">Join your regional chapter to meet alumni near you</p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create chapter
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                aria-label="Search chapters"
                placeholder="Search chapters by name, region or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="w-full md:w-[220px]" aria-label="Filter by region">
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_REGIONS}>All regions</SelectItem>
                {regions.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6" role="status" aria-label="Loading chapters">
          {Array.from({ length: 6 }, (_, i) => (
            <ChapterCardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span>{getApiErrorMessage(error, 'Failed to load chapters. Please try again later.')}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-20" aria-hidden="true" />
          <h3 className="text-lg font-medium">{filtersActive ? 'No chapters match your filters' : 'No chapters yet'}</h3>
          <p className="text-muted-foreground">
            {filtersActive
              ? 'Try a different search or region.'
              : canCreate
                ? 'Create the first chapter to get started.'
                : 'Check back soon. Chapters are created by platform admins.'}
          </p>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visible.map((chapter) => {
              const member = membership.isMember(chapter.id);
              const pending = membership.pendingId === chapter.id;
              const members = chapterMemberCount(chapter);
              return (
                <Card key={chapter.id} className="flex flex-col hover:shadow-md transition-shadow" data-testid="chapter-card">
                  <CardContent className="p-6 flex flex-col flex-1">
                    <div className="flex items-start gap-3 mb-3">
                      <Avatar className="h-12 w-12">
                        {chapter.logoUrl && <AvatarImage src={chapter.logoUrl} alt="" />}
                        <AvatarFallback className="bg-[#002045] text-white">{getInitials(chapter.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <Link href={`/chapters/${chapter.id}`} className="font-semibold text-lg hover:underline line-clamp-1">
                          {chapter.name}
                        </Link>
                        <div className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="truncate">{chapter.region}</span>
                        </div>
                      </div>
                      {member && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Member</Badge>}
                    </div>

                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4 flex-1">
                      {chapter.description || 'No description yet.'}
                    </p>

                    <div className="space-y-1.5 text-sm text-muted-foreground mb-4">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4" aria-hidden="true" />
                        <span>
                          {members} {members === 1 ? 'member' : 'members'}
                        </span>
                        {typeof chapter._count?.events === 'number' && (
                          <>
                            <CalendarDays className="h-4 w-4 ml-2" aria-hidden="true" />
                            <span>
                              {chapter._count.events} {chapter._count.events === 1 ? 'event' : 'events'}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <UserRound className="h-4 w-4" aria-hidden="true" />
                        <span className="truncate">
                          {chapter.admin?.fullName ? `Admin: ${chapter.admin.fullName}` : 'No chapter admin yet'}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button asChild variant="outline" size="sm" className="flex-1">
                        <Link href={`/chapters/${chapter.id}`}>View</Link>
                      </Button>
                      {membership.signedIn ? (
                        <Button
                          size="sm"
                          className="flex-1"
                          variant={member ? 'secondary' : 'default'}
                          disabled={pending || membership.isLoadingMemberships}
                          onClick={() =>
                            member ? membership.leave(chapter.id, chapter.name) : membership.join(chapter.id, chapter.name)
                          }
                          aria-label={`${member ? 'Leave' : 'Join'} ${chapter.name}`}
                        >
                          {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          {member ? 'Leave' : 'Join'}
                        </Button>
                      ) : (
                        <Button asChild size="sm" className="flex-1">
                          <Link href="/login">Sign in to join</Link>
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {totalPages > 1 && (
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
        </>
      )}

      {canCreate && (
        <ChapterFormDialog open={createOpen} onOpenChange={setCreateOpen} mode="create" onSubmit={createChapter} />
      )}
    </div>
  );
}
