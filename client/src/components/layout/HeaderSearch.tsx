'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SEARCH_MAX_QUERY_LENGTH, SEARCH_MIN_QUERY_LENGTH, buildSearchHref, cleanQuery } from '@/lib/search';

const inputClass =
  'h-10 w-full rounded-full border-0 bg-secondary pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary';

function SearchForm({ placeholder, className }: { placeholder: string; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // On the results page the box shows the query being viewed, so it is the one place to refine it
  const shownQuery = pathname === '/search' ? searchParams?.get('q') ?? '' : '';
  const [value, setValue] = useState(shownQuery);

  useEffect(() => {
    setValue(shownQuery);
  }, [shownQuery]);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const query = cleanQuery(value);
    if (query.length < SEARCH_MIN_QUERY_LENGTH) return;
    router.push(buildSearchHref(query));
  };

  return (
    <form role="search" aria-label="Site search" onSubmit={onSubmit} className={cn('relative w-full', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        name="q"
        type="search"
        aria-label="Search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        maxLength={SEARCH_MAX_QUERY_LENGTH}
        autoComplete="off"
        className={inputClass}
      />
    </form>
  );
}

/**
 * THE search box of the site. Both headers (visitors and members) use this one component, so there is a
 * single, consistent place to search from; the results page does not repeat it on wide screens.
 */
export function HeaderSearch({ placeholder, className }: { placeholder: string; className?: string }) {
  return (
    <Suspense fallback={<div aria-hidden="true" className={cn('h-10 w-full rounded-full bg-secondary', className)} />}>
      <SearchForm placeholder={placeholder} className={className} />
    </Suspense>
  );
}

/**
 * On narrow screens there is no room for the box: one icon opens the search page, which shows its own
 * search field there (and only there).
 */
const HIDE_FROM = { md: 'md:hidden', lg: 'lg:hidden', xl: 'xl:hidden' } as const;

export function MobileSearchLink({ className, hideFrom = 'md' }: { className?: string; hideFrom?: keyof typeof HIDE_FROM }) {
  const pathname = usePathname();
  // On the search page the field is already in the page: an icon pointing at the same page is just noise
  if (pathname === '/search') return null;
  return (
    <Link
      href="/search"
      aria-label="Search"
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground',
        HIDE_FROM[hideFrom],
        className
      )}
    >
      <Search aria-hidden="true" className="h-5 w-5" />
    </Link>
  );
}
