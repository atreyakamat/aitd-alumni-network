import { describe, expect, it } from 'vitest';
import {
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  availableFilters,
  buildSearchHref,
  cleanQuery,
  countResults,
  normalizeSearchResults,
  sectionsWithResults,
} from '@/lib/search';

describe('cleanQuery', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(cleanQuery('  data   science ')).toBe('data science');
    expect(cleanQuery('x'.repeat(SEARCH_MAX_QUERY_LENGTH + 20))).toHaveLength(SEARCH_MAX_QUERY_LENGTH);
  });

  it.each([null, undefined, 42, {}, ['a']])('treats %j as empty', (value) => {
    expect(cleanQuery(value)).toBe('');
  });
});

describe('buildSearchHref', () => {
  it('encodes the query into /search', () => {
    expect(buildSearchHref(' c++ & java ')).toBe('/search?q=c%2B%2B%20%26%20java');
  });

  it('falls back to the bare search page for queries that are too short to run', () => {
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(2);
    expect(buildSearchHref('a')).toBe('/search');
    expect(buildSearchHref('   ')).toBe('/search');
    expect(buildSearchHref(undefined)).toBe('/search');
  });
});

describe('normalizeSearchResults', () => {
  it('fills every missing list with [] and defaults to the member scope (older servers required a login)', () => {
    expect(normalizeSearchResults({ users: [{ id: 'u1' }] })).toEqual({
      scope: 'member',
      users: [{ id: 'u1' }],
      jobs: [],
      events: [],
      posts: [],
      news: [],
      chapters: [],
    });
  });

  it('keeps the public scope', () => {
    expect(normalizeSearchResults({ scope: 'public', events: [{ id: 'e1' }] }).scope).toBe('public');
  });

  it.each([null, undefined, 'x', 5, [], { users: 'nope', jobs: null }])('survives malformed payload %j', (payload) => {
    const out = normalizeSearchResults(payload);
    expect(out.users).toEqual([]);
    expect(out.jobs).toEqual([]);
    expect(countResults(out)).toBe(0);
  });

  it('ignores an unknown scope', () => {
    expect(normalizeSearchResults({ scope: 'admin' }).scope).toBe('member');
  });
});

describe('counting and sections', () => {
  const results = normalizeSearchResults({
    users: [{ id: 'u1' }, { id: 'u2' }],
    events: [{ id: 'e1' }],
    news: [{ id: 'n1' }],
  });

  it('counts per section and in total', () => {
    expect(countResults(results)).toBe(4);
    expect(countResults(results, 'users')).toBe(2);
    expect(countResults(results, 'jobs')).toBe(0);
    expect(countResults(results, 'all')).toBe(4);
  });

  it('lists only the sections that have results, in a stable order', () => {
    expect(sectionsWithResults(results)).toEqual(['users', 'events', 'news']);
  });
});

describe('availableFilters', () => {
  it('offers every section to members', () => {
    expect(availableFilters('member')).toEqual(['all', 'users', 'jobs', 'events', 'news', 'chapters', 'posts']);
  });

  it('offers only the public sections to anonymous visitors', () => {
    expect(availableFilters('public')).toEqual(['all', 'events', 'news', 'chapters']);
  });
});
