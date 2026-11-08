'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Lock, Search } from 'lucide-react';
import { searchApi, getApiErrorMessage } from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchResultsView } from '@/components/search/SearchResultsView';
import { buildLoginHref, buildRegisterHref } from '@/lib/public-paths';
import {
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_SECTION_LABELS,
  availableFilters,
  buildSearchHref,
  cleanQuery,
  countResults,
  normalizeSearchResults,
  type SearchFilter,
  type SearchResults,
  type SearchScope,
} from '@/lib/search';

/** Tells visitors why the list is short and what an account adds (they get public results only). */
function PublicScopeNote({ query }: { query: string }) {
  const returnTo = buildSearchHref(query);
  return (
    <aside role="note" className="flex flex-col gap-3 rounded-lg border border-amber-300/60 bg-amber-50 p-4 text-sm sm:flex-row sm:items-center sm:justify-between dark:bg-amber-950/20">
      <p className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
        <span>
          <strong>Showing public results only.</strong> To search alumni, jobs and posts too, sign in with your
          account.
        </span>
      </p>
      <span className="flex shrink-0 gap-2">
        <Button size="sm" asChild>
          <Link href={buildLoginHref(returnTo)}>Sign in</Link>
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link href={buildRegisterHref(returnTo)}>Join now</Link>
        </Button>
      </span>
    </aside>
  );
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const query = cleanQuery(searchParams?.get('q'));
  const canSearch = query.length >= SEARCH_MIN_QUERY_LENGTH;

  const [input, setInput] = useState(query);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SearchFilter>('all');
  const latest = useRef(0);

  const run = useCallback(async (term: string) => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const response = await searchApi.globalSearch(term);
      if (id !== latest.current) return; // a newer search replaced this one
      setResults(normalizeSearchResults(response.data.data));
    } catch (err) {
      if (id !== latest.current) return;
      setResults(null);
      setError(getApiErrorMessage(err, 'Search failed. Please try again.'));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setInput(query);
    setFilter('all');
    if (canSearch) {
      void run(query);
    } else {
      latest.current += 1; // drop anything still in flight
      setResults(null);
      setError(null);
      setLoading(false);
    }
  }, [query, canSearch, run]);

  const scope: SearchScope = results?.scope ?? (isAuthenticated ? 'member' : 'public');
  const filters = availableFilters(scope);
  const total = results ? countResults(results) : 0;

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const term = cleanQuery(input);
    if (term.length >= SEARCH_MIN_QUERY_LENGTH) router.push(buildSearchHref(term));
  };

  return (
    <div className="container max-w-4xl py-8">
      <h1 className="mb-4 text-2xl font-bold sm:text-3xl">{canSearch ? `Results for “${query}”` : 'Search'}</h1>

      {/*
        The header already holds THE search box on wide screens. This field only exists where the header
        has none (phones; and tablets for visitors), so there is never a second box next to the first.
      */}
      <form role="search" aria-label="Search the site" onSubmit={onSubmit} className={`mb-6 flex gap-2 ${isAuthenticated ? 'md:hidden' : 'xl:hidden'}`}>
        <div className="relative flex-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={isAuthenticated ? 'Search people, jobs, events, news...' : 'Search events, news, chapters...'}
            className="h-11 rounded-full pl-10"
            maxLength={SEARCH_MAX_QUERY_LENGTH}
            aria-label="Search"
            autoFocus={!canSearch}
          />
        </div>
        <Button type="submit" className="rounded-full">
          Search
        </Button>
      </form>

      {!isAuthenticated && <div className="mb-6"><PublicScopeNote query={query} /></div>}

      {input.trim().length > 0 && !canSearch && (
        <p className="mb-4 text-sm text-muted-foreground">Type at least {SEARCH_MIN_QUERY_LENGTH} characters to search.</p>
      )}

      {error ? (
        <div role="alert" className="flex flex-col items-center py-16 text-center">
          <p className="mb-3 font-medium text-destructive">{error}</p>
          <Button variant="outline" onClick={() => void run(query)}>
            Try again
          </Button>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center py-20" aria-live="polite">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-primary" aria-hidden="true" />
          <p className="text-muted-foreground">Searching…</p>
        </div>
      ) : results && canSearch ? (
        <>
          <div role="group" aria-label="Filter results" className="mb-6 flex flex-wrap gap-2">
            {filters.map((name) => {
              const label = name === 'all' ? 'All' : SEARCH_SECTION_LABELS[name];
              const active = filter === name;
              return (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  aria-pressed={active}
                  className="rounded-full"
                  onClick={() => setFilter(name)}
                >
                  {label}{' '}
                  <span className="ml-1 opacity-80">{countResults(results, name)}</span>
                </Button>
              );
            })}
          </div>

          {total === 0 ? (
            <div className="rounded-xl border-2 border-dashed py-14 text-center">
              <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <h2 className="mb-1 text-lg font-semibold">No results for “{query}”</h2>
              <p className="text-sm text-muted-foreground">Check the spelling or try a shorter, more general word.</p>
            </div>
          ) : (
            <SearchResultsView results={results} filter={filter} />
          )}
        </>
      ) : !canSearch ? (
        <div className="rounded-xl border-2 border-dashed py-14 text-center">
          <Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <h2 className="mb-1 text-lg font-semibold">Search the network</h2>
          <p className="text-sm text-muted-foreground">
            {isAuthenticated
              ? 'Find alumni, jobs, events, news, chapters and posts.'
              : 'Find events, news and chapters.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="container flex justify-center py-8"><Loader2 className="animate-spin" /></div>}>
      <SearchPageContent />
    </Suspense>
  );
}
