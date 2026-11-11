'use client';

import Link from 'next/link';
import { Briefcase, CalendarDays, MapPin, Newspaper, MessageSquare, Users, User as UserIcon } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { eventPlaceLabel } from '@/lib/events';
import { getInitials } from '@/lib/utils';
import {
  SEARCH_SECTIONS,
  SEARCH_SECTION_LABELS,
  type SearchFilter,
  type SearchResults,
  type SearchSection,
} from '@/lib/search';

const cardClass = 'block rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

const SECTION_ICONS: Record<SearchSection, typeof Users> = {
  users: UserIcon,
  jobs: Briefcase,
  events: CalendarDays,
  news: Newspaper,
  chapters: Users,
  posts: MessageSquare,
};

const snippet = (text: unknown, max = 160) => {
  const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const dateBadge = (value: unknown) => {
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return {
    month: date.toLocaleDateString('en-US', { month: 'short' }),
    day: date.getDate(),
  };
};

function PersonCard({ user }: { user: any }) {
  return (
    <Link href={`/profile/${user.id}`} className={`${cardClass} flex items-center gap-4`}>
      <Avatar className="h-12 w-12">
        <AvatarImage src={user.profilePhotoUrl ?? undefined} alt="" />
        <AvatarFallback>{getInitials(user.fullName ?? '?')}</AvatarFallback>
      </Avatar>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{user.fullName}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {[user.currentDesignation || 'Alumnus', user.batchYear ? `Class of ${user.batchYear}` : null, user.department]
            .filter(Boolean)
            .join(' • ')}
        </span>
      </span>
    </Link>
  );
}

function JobCard({ job }: { job: any }) {
  const where = job.location || (job.workplaceType === 'REMOTE' ? 'Remote' : null);
  return (
    <Link href={`/jobs/${job.id}`} className={`${cardClass} flex items-center justify-between gap-4`}>
      <span className="flex min-w-0 items-center gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-secondary">
          <Briefcase className="h-6 w-6 text-primary" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{job.title}</span>
          <span className="block truncate text-sm text-muted-foreground">{[job.company, where].filter(Boolean).join(' • ')}</span>
        </span>
      </span>
      {job.jobType && <Badge variant="secondary">{String(job.jobType).replace(/_/g, ' ')}</Badge>}
    </Link>
  );
}

function EventCard({ event }: { event: any }) {
  const badge = dateBadge(event.startDate);
  const place = eventPlaceLabel(event);
  return (
    <Link href={`/events/${event.id}`} className={`${cardClass} flex gap-4`}>
      <span className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">
        {badge ? (
          <>
            <span className="text-xs font-bold uppercase">{badge.month}</span>
            <span className="text-xl font-bold">{badge.day}</span>
          </>
        ) : (
          <CalendarDays className="h-6 w-6" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{event.title}</span>
        <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3 w-3" aria-hidden="true" /> {place}
        </span>
      </span>
    </Link>
  );
}

function NewsCard({ article }: { article: any }) {
  return (
    <Link href={`/news/${article.slug}`} className={`${cardClass} flex items-start gap-4`}>
      <Newspaper className="mt-1 h-6 w-6 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-semibold">{article.title}</span>
        {article.excerpt && <span className="mt-1 block text-sm text-muted-foreground">{snippet(article.excerpt, 140)}</span>}
      </span>
    </Link>
  );
}

function ChapterCard({ chapter }: { chapter: any }) {
  return (
    <Link href={`/chapters/${chapter.id}`} className={`${cardClass} flex items-center gap-4`}>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-secondary">
        <Users className="h-6 w-6 text-primary" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold">{chapter.name}</span>
        <span className="block truncate text-sm text-muted-foreground">
          {[chapter.region, typeof chapter.memberCount === 'number' ? `${chapter.memberCount} members` : null].filter(Boolean).join(' • ')}
        </span>
      </span>
    </Link>
  );
}

function PostCard({ post }: { post: any }) {
  return (
    <Link href={`/posts/${post.id}`} className={`${cardClass} block`}>
      <span className="block text-sm">{snippet(post.content, 220)}</span>
      {post.user?.fullName && <span className="mt-2 block text-xs text-muted-foreground">by {post.user.fullName}</span>}
    </Link>
  );
}

const renderers: Record<SearchSection, (item: any) => JSX.Element> = {
  users: (item) => <PersonCard key={item.id} user={item} />,
  jobs: (item) => <JobCard key={item.id} job={item} />,
  events: (item) => <EventCard key={item.id} event={item} />,
  news: (item) => <NewsCard key={item.id} article={item} />,
  chapters: (item) => <ChapterCard key={item.id} chapter={item} />,
  posts: (item) => <PostCard key={item.id} post={item} />,
};

const gridClass: Record<SearchSection, string> = {
  users: 'grid gap-3 sm:grid-cols-2',
  jobs: 'grid gap-3',
  events: 'grid gap-3 sm:grid-cols-2',
  news: 'grid gap-3',
  chapters: 'grid gap-3 sm:grid-cols-2',
  posts: 'grid gap-3',
};

/** The result sections for the chosen filter (all sections that have results, or just one). */
export function SearchResultsView({ results, filter }: { results: SearchResults; filter: SearchFilter }) {
  const sections = filter === 'all' ? SEARCH_SECTIONS : [filter];
  return (
    <div className="space-y-8">
      {sections.map((section) => {
        const items = results[section];
        if (items.length === 0) return null;
        const Icon = SECTION_ICONS[section];
        return (
          <section key={section} aria-labelledby={`search-${section}`}>
            <h2 id={`search-${section}`} className="mb-3 flex items-center gap-2 text-lg font-bold">
              <Icon className="h-5 w-5" aria-hidden="true" />
              {SEARCH_SECTION_LABELS[section]}
            </h2>
            <div className={gridClass[section]}>{items.map(renderers[section])}</div>
          </section>
        );
      })}
    </div>
  );
}
