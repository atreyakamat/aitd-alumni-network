'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarDays, ChevronLeft, Loader2, MapPin, Pencil, Users } from 'lucide-react';
import { chapterApi, getApiErrorMessage, readPaginated } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { canEditChapter, chapterMemberCount } from '@/lib/chapters';
import { useChapterMembership } from '@/components/chapters/useChapterMembership';
import { ChapterFormDialog } from '@/components/chapters/ChapterFormDialog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { formatDate, formatDateTime, getInitials } from '@/lib/utils';
import type { ChapterDetail, ChapterMember } from '@/types';

const MEMBERS_PAGE_SIZE = 20;

const isNotFound = (err: unknown) => (err as any)?.response?.status === 404;

function DetailSkeleton() {
  return (
    <div className="max-w-5xl mx-auto space-y-6" role="status" aria-label="Loading chapter">
      <Skeleton className="h-9 w-40" />
      <Card>
        <CardContent className="p-6 flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </CardContent>
      </Card>
      <div className="grid lg:grid-cols-3 gap-6">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export default function ChapterDetailPage() {
  const params = useParams();
  const id = (params?.id as string) ?? '';
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const membership = useChapterMembership();
  const [membersPage, setMembersPage] = useState(1);
  const [editOpen, setEditOpen] = useState(false);

  const chapterQuery = useQuery({
    queryKey: ['chapters', 'detail', id],
    enabled: !!id,
    retry: (count, err) => !isNotFound(err) && count < 1,
    queryFn: async (): Promise<ChapterDetail> => (await chapterApi.getChapter(id)).data.data,
  });

  const membersQuery = useQuery({
    queryKey: ['chapters', 'members', id, membersPage],
    enabled: !!id && membership.signedIn && chapterQuery.isSuccess,
    queryFn: async () => (await chapterApi.getMembers(id, membersPage, MEMBERS_PAGE_SIZE)).data,
  });

  if (chapterQuery.isLoading) return <DetailSkeleton />;

  if (chapterQuery.isError || !chapterQuery.data) {
    const notFound = isNotFound(chapterQuery.error);
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" aria-hidden="true" />
        <h2 className="text-2xl font-bold mb-2">{notFound ? 'Chapter not found' : 'Something went wrong'}</h2>
        <p className="text-muted-foreground mb-6">
          {notFound
            ? 'This chapter does not exist or is no longer active.'
            : getApiErrorMessage(chapterQuery.error, 'Failed to load this chapter.')}
        </p>
        <div className="flex justify-center gap-2">
          {!notFound && (
            <Button variant="outline" onClick={() => chapterQuery.refetch()}>
              Retry
            </Button>
          )}
          <Button asChild>
            <Link href="/chapters">Back to Chapters</Link>
          </Button>
        </div>
      </div>
    );
  }

  const chapter = chapterQuery.data;
  const member = membership.isMember(chapter.id);
  const pending = membership.pendingId === chapter.id;
  const canEdit = canEditChapter(user, chapter);
  const memberCount = chapterMemberCount(chapter);
  const events = chapter.events ?? [];
  const { items: members, totalPages: memberPages } = readPaginated<ChapterMember>(membersQuery.data);

  const saveChapter = async (payload: Parameters<typeof chapterApi.updateChapter>[1]) => {
    await chapterApi.updateChapter(chapter.id, payload);
    toast({ title: 'Chapter updated' });
    queryClient.invalidateQueries({ queryKey: ['chapters'] });
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Button asChild variant="ghost" className="mb-2">
        <Link href="/chapters">
          <ChevronLeft className="h-4 w-4 mr-2" />
          Back to Chapters
        </Link>
      </Button>

      <Card>
        <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-6">
          <Avatar className="h-20 w-20">
            {chapter.logoUrl && <AvatarImage src={chapter.logoUrl} alt="" />}
            <AvatarFallback className="bg-[#002045] text-white text-xl">{getInitials(chapter.name)}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-[#002045]">{chapter.name}</h1>
              {member && <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Member</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {chapter.region}
              </span>
              <span className="flex items-center gap-1">
                <Users className="h-4 w-4" aria-hidden="true" />
                {memberCount} {memberCount === 1 ? 'member' : 'members'}
              </span>
              <span>Since {formatDate(chapter.createdAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit chapter
              </Button>
            )}
            {membership.signedIn ? (
              <Button
                variant={member ? 'secondary' : 'default'}
                disabled={pending || membership.isLoadingMemberships}
                onClick={() => (member ? membership.leave(chapter.id, chapter.name) : membership.join(chapter.id, chapter.name))}
              >
                {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {member ? 'Leave chapter' : 'Join chapter'}
              </Button>
            ) : (
              <Button asChild>
                <Link href="/login">Sign in to join</Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground whitespace-pre-line">
                {chapter.description || 'This chapter has not added a description yet.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upcoming events</CardTitle>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <div className="text-center py-6">
                  <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground mb-2 opacity-20" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">No upcoming events for this chapter.</p>
                </div>
              ) : (
                <ul className="divide-y">
                  {events.map((event) => (
                    <li key={event.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <Link href={`/events/${event.id}`} className="font-medium hover:underline line-clamp-1">
                          {event.title}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {formatDateTime(event.startDate)}
                          {event.city ? ` · ${event.city}` : ''}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/events/${event.id}`}>Details</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Chapter admin</CardTitle>
            </CardHeader>
            <CardContent>
              {chapter.admin ? (
                <Link href={`/profile/${chapter.admin.id}`} className="flex items-center gap-3 group">
                  <Avatar>
                    {chapter.admin.profilePhotoUrl && <AvatarImage src={chapter.admin.profilePhotoUrl} alt="" />}
                    <AvatarFallback>{getInitials(chapter.admin.fullName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-medium group-hover:underline truncate">{chapter.admin.fullName}</p>
                    {chapter.admin.currentDesignation && (
                      <p className="text-sm text-muted-foreground truncate">{chapter.admin.currentDesignation}</p>
                    )}
                  </div>
                </Link>
              ) : (
                <p className="text-sm text-muted-foreground">No chapter admin assigned yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardContent>
              {!membership.signedIn ? (
                <p className="text-sm text-muted-foreground">
                  <Link href="/login" className="text-primary hover:underline">
                    Sign in
                  </Link>{' '}
                  to see who is in this chapter.
                </p>
              ) : membersQuery.isLoading ? (
                <div className="space-y-3" role="status" aria-label="Loading members">
                  {Array.from({ length: 4 }, (_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <Skeleton className="h-4 flex-1" />
                    </div>
                  ))}
                </div>
              ) : membersQuery.isError ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{getApiErrorMessage(membersQuery.error, 'Failed to load members.')}</AlertDescription>
                </Alert>
              ) : members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members yet. Be the first to join!</p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {members.map((m) => (
                      <li key={m.id}>
                        <Link href={`/profile/${m.id}`} className="flex items-center gap-3 group">
                          <Avatar className="h-10 w-10">
                            {m.profilePhotoUrl && <AvatarImage src={m.profilePhotoUrl} alt="" />}
                            <AvatarFallback>{getInitials(m.fullName)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-sm font-medium group-hover:underline truncate">{m.fullName}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {[m.batchYear ? `Batch ${m.batchYear}` : null, m.currentDesignation, m.city]
                                .filter(Boolean)
                                .join(' · ')}
                            </p>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  {memberPages > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMembersPage((p) => Math.max(1, p - 1))}
                        disabled={membersPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {membersPage} / {memberPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMembersPage((p) => Math.min(memberPages, p + 1))}
                        disabled={membersPage >= memberPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {canEdit && (
        <ChapterFormDialog open={editOpen} onOpenChange={setEditOpen} mode="edit" chapter={chapter} onSubmit={saveChapter} />
      )}
    </div>
  );
}
