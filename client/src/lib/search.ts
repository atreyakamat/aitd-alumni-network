/**
 * Global search: query rules, response normalisation and which sections a visitor can see.
 *
 * The API answers anonymous visitors with public content only (events, news, chapters) and says so in
 * `scope`; signed-in members additionally get people, jobs and posts.
 */

export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 100;

export type SearchScope = 'public' | 'member';
export type SearchSection = 'users' | 'jobs' | 'events' | 'news' | 'chapters' | 'posts';
export type SearchFilter = 'all' | SearchSection;

/** Display order of the sections (people first, like a network search). */
export const SEARCH_SECTIONS: readonly SearchSection[] = ['users', 'jobs', 'events', 'news', 'chapters', 'posts'];
const PUBLIC_SECTIONS: readonly SearchSection[] = ['events', 'news', 'chapters'];

export const SEARCH_SECTION_LABELS: Record<SearchSection, string> = {
  users: 'People',
  jobs: 'Jobs',
  events: 'Events',
  news: 'News',
  chapters: 'Chapters',
  posts: 'Posts',
};

export interface SearchResults {
  scope: SearchScope;
  users: any[];
  jobs: any[];
  events: any[];
  posts: any[];
  news: any[];
  chapters: any[];
}

/** One trimmed, single-spaced, length-capped query string; anything that is not a string is ''. */
export function cleanQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, SEARCH_MAX_QUERY_LENGTH);
}

/** `/search?q=…` for a runnable query, otherwise the bare search page. */
export function buildSearchHref(raw: unknown): string {
  const query = cleanQuery(raw);
  return query.length >= SEARCH_MIN_QUERY_LENGTH ? `/search?q=${encodeURIComponent(query)}` : '/search';
}

const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);

export function normalizeSearchResults(data: unknown): SearchResults {
  const d = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  return {
    // Servers from before public search always required a login, so a missing scope means a member
    scope: d.scope === 'public' ? 'public' : 'member',
    users: list(d.users),
    jobs: list(d.jobs),
    events: list(d.events),
    posts: list(d.posts),
    news: list(d.news),
    chapters: list(d.chapters),
  };
}

export function countResults(results: SearchResults, filter: SearchFilter = 'all'): number {
  if (filter !== 'all') return results[filter].length;
  return SEARCH_SECTIONS.reduce((total, section) => total + results[section].length, 0);
}

export function sectionsWithResults(results: SearchResults): SearchSection[] {
  return SEARCH_SECTIONS.filter((section) => results[section].length > 0);
}

/** The filter chips a visitor is offered. */
export function availableFilters(scope: SearchScope): SearchFilter[] {
  return ['all', ...(scope === 'public' ? PUBLIC_SECTIONS : SEARCH_SECTIONS)];
}
