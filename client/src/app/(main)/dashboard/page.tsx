'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/auth-context';
import { eventApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { mediaSrc } from '@/lib/social';
import { PostComposer } from '@/components/social/PostComposer';
import { Feed, type PostListHandle } from '@/components/social/Feed';
import { TrendingHashtags, WhoToFollow } from '@/components/social/Sidebar';

interface UpcomingEvent {
  id: string;
  title: string;
  startDate: string;
  location?: string | null;
  city?: string | null;
  venue?: string | null;
}

export default function DashboardPage() {
  const { user: currentUser } = useAuth();
  const feedRef = useRef<PostListHandle>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    eventApi
      .getUpcoming(3)
      .then((res) => {
        const list = res.data?.data;
        if (!cancelled) setUpcomingEvents(Array.isArray(list) ? list : []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {/* Centre: composer + feed */}
      <div className="min-w-0 space-y-4">
        <h1 className="sr-only">Home feed</h1>
        <PostComposer onCreated={(post) => feedRef.current?.prepend(post)} />
        <Feed
          ref={feedRef}
          emptyAction={
            <Button asChild variant="outline" size="sm">
              <Link href="/network">Find alumni to follow</Link>
            </Button>
          }
        />
      </div>

      {/* Right sidebar: profile summary + discovery */}
      <aside className="space-y-6" aria-label="Discover">
        {/* Profile card: not reachable from the header as a summary, so it stays (desktop only). The
            former "Shortcuts" card duplicated the header nav (Reels, Saved, Network, Jobs, Events) and is gone. */}
        <section className="hidden lg:block" aria-label="Your profile">
          <Card>
            <div className="h-16 rounded-t-lg bg-gradient-to-r from-primary to-primary/80" />
            <CardContent className="-mt-8 pt-0">
              <div className="flex flex-col items-center text-center">
                <Avatar className="h-16 w-16 border-4 border-background">
                  <AvatarImage src={mediaSrc(currentUser?.avatarUrl) || undefined} alt="" />
                  <AvatarFallback className="text-lg">{currentUser?.fullName ? getInitials(currentUser.fullName) : 'U'}</AvatarFallback>
                </Avatar>
                <h2 className="mt-2 font-semibold">{currentUser?.fullName}</h2>
                <p className="text-sm text-muted-foreground">
                  {currentUser?.department} · Batch {currentUser?.batchYear}
                </p>
              </div>
              <div className="mt-4 space-y-2 border-t pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Profile completeness</span>
                  <span className="font-medium">{currentUser?.profileCompleteness || 0}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={currentUser?.profileCompleteness || 0} aria-label="Profile completeness">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${currentUser?.profileCompleteness || 0}%` }} />
                </div>
                <Button asChild variant="outline" size="sm" className="mt-2 w-full">
                  <Link href={currentUser ? `/profile/${encodeURIComponent(currentUser.id)}` : '/profile/edit'}>View profile</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
        <TrendingHashtags />
        <WhoToFollow />
        {upcomingEvents.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upcoming events</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {upcomingEvents.map((event) => {
                const date = new Date(event.startDate);
                const valid = !Number.isNaN(date.getTime());
                return (
                  <Link key={event.id} href={`/events/${encodeURIComponent(event.id)}`} className="flex gap-3 rounded-md hover:bg-muted/50">
                    <div className="min-w-[50px] rounded-lg bg-primary/10 p-2 text-center">
                      <p className="text-xs font-medium text-primary">{valid ? date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() : '—'}</p>
                      <p className="text-lg font-bold text-primary">{valid ? date.getDate() : ''}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{event.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{event.city || event.venue || event.location || 'Online'}</p>
                    </div>
                  </Link>
                );
              })}
              <Button asChild variant="ghost" size="sm" className="w-full">
                <Link href="/events">View all events</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </aside>
    </div>
  );
}
