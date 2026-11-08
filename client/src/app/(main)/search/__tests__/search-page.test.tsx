import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const push = vi.fn();
let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams(query ? `q=${encodeURIComponent(query)}` : ''),
}));

let authenticated = true;
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: authenticated, isLoading: false, user: authenticated ? { id: 'me' } : null }),
}));

const globalSearch = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<any>('@/lib/api');
  return { ...actual, searchApi: { globalSearch: (...args: unknown[]) => globalSearch(...args) } };
});

import SearchPage from '../page';

const memberResults = {
  scope: 'member',
  users: [{ id: 'u1', fullName: 'Asha Rao', currentDesignation: 'Engineer', batchYear: 2015, department: 'Computer' }],
  jobs: [{ id: 'j1', title: 'Backend Engineer', company: 'Acme', location: 'Pune', jobType: 'FULL_TIME' }],
  events: [{ id: 'e1', title: 'Pune Meetup', startDate: '2099-03-01T10:00:00Z', eventType: 'OFFLINE', city: 'Pune' }],
  news: [{ id: 'n1', title: 'Campus Update', slug: 'campus-update', excerpt: 'New lab opened', category: 'INSTITUTE_UPDATE' }],
  chapters: [{ id: 'c1', name: 'Pune Chapter', region: 'Maharashtra', memberCount: 42 }],
  posts: [{ id: 'p1', content: 'Hiring engineers in Pune this month', user: { id: 'u1', fullName: 'Asha Rao' } }],
};

const publicResults = {
  scope: 'public',
  users: [],
  jobs: [],
  posts: [],
  events: memberResults.events,
  news: memberResults.news,
  chapters: memberResults.chapters,
};

beforeEach(() => {
  push.mockClear();
  globalSearch.mockReset();
  query = '';
  authenticated = true;
});

const renderResults = async (q: string, payload: unknown) => {
  query = q;
  globalSearch.mockResolvedValue({ data: { data: payload } });
  render(<SearchPage />);
  await waitFor(() => expect(globalSearch).toHaveBeenCalledWith(q));
  await screen.findByRole('heading', { level: 1, name: new RegExp(q) });
  await waitFor(() => expect(screen.queryByText(/searching/i)).not.toBeInTheDocument());
};

describe('search page: one search field, no duplicate controls', () => {
  it('has exactly one text field, which is hidden on wide screens where the header box already exists (member)', async () => {
    await renderResults('pune', memberResults);
    const fields = screen.getAllByRole('searchbox');
    expect(fields).toHaveLength(1);
    expect(fields[0].closest('form')!.className).toMatch(/md:hidden/);
  });

  it('hides it from the wider breakpoint at which the visitor header shows its own box (anonymous)', async () => {
    authenticated = false;
    await renderResults('pune', publicResults);
    expect(screen.getAllByRole('searchbox')[0].closest('form')!.className).toMatch(/xl:hidden/);
  });

  it('submitting it runs the search through the URL', async () => {
    await renderResults('pune', memberResults);
    const field = screen.getByRole('searchbox');
    fireEvent.change(field, { target: { value: 'data science' } });
    fireEvent.submit(field.closest('form')!);
    expect(push).toHaveBeenCalledWith('/search?q=data%20science');
  });
});

describe('search page: member results', () => {
  it('shows every section with working links', async () => {
    await renderResults('pune', memberResults);

    expect(screen.getByRole('link', { name: /Asha Rao.*Engineer/i })).toHaveAttribute('href', '/profile/u1');
    expect(screen.getByRole('link', { name: /Backend Engineer/ })).toHaveAttribute('href', '/jobs/j1');
    expect(screen.getByRole('link', { name: /Pune Meetup/ })).toHaveAttribute('href', '/events/e1');
    expect(screen.getByRole('link', { name: /Campus Update/ })).toHaveAttribute('href', '/news/campus-update');
    expect(screen.getByRole('link', { name: /Pune Chapter/ })).toHaveAttribute('href', '/chapters/c1');
    expect(screen.getByRole('link', { name: /Hiring engineers/ })).toHaveAttribute('href', '/posts/p1');
    for (const heading of ['People', 'Jobs', 'Events', 'News', 'Chapters', 'Posts']) {
      expect(screen.getByRole('heading', { level: 2, name: heading })).toBeInTheDocument();
    }
  });

  it('does not show the sign-in note to members', async () => {
    await renderResults('pune', memberResults);
    expect(screen.queryByText(/public results only/i)).not.toBeInTheDocument();
  });

  it('filter chips show counts and narrow the list to one section', async () => {
    await renderResults('pune', memberResults);
    const filters = screen.getByRole('group', { name: /filter results/i });
    expect(within(filters).getByRole('button', { name: /^All 6$/ })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(within(filters).getByRole('button', { name: /^Jobs 1$/ }));

    expect(screen.getByRole('link', { name: /Backend Engineer/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Pune Meetup/ })).not.toBeInTheDocument();
    expect(within(filters).getByRole('button', { name: /^Jobs 1$/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('says so when nothing matched', async () => {
    await renderResults('zzzz', { scope: 'member', users: [], jobs: [], events: [], posts: [], news: [], chapters: [] });
    expect(screen.getByText(/no results for/i)).toBeInTheDocument();
  });
});

describe('search page: visitors without an account', () => {
  it('see the public results and a clear note that signing in unlocks the rest', async () => {
    authenticated = false;
    await renderResults('pune', publicResults);

    expect(screen.getByRole('link', { name: /Pune Meetup/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Campus Update/ })).toBeInTheDocument();
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(/public results only/i);
    expect(note).toHaveTextContent(/alumni, jobs and posts/i);
    expect(within(note).getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login?next=%2Fsearch%3Fq%3Dpune');
    expect(within(note).getByRole('link', { name: /join|create/i })).toHaveAttribute('href', '/register?next=%2Fsearch%3Fq%3Dpune');
  });

  it('are only offered the public filters', async () => {
    authenticated = false;
    await renderResults('pune', publicResults);
    const filters = screen.getByRole('group', { name: /filter results/i });
    const names = within(filters).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['All 3', 'Events 1', 'News 1', 'Chapters 1']);
  });

  it('with no public match, still explain what signing in adds (no dead end)', async () => {
    authenticated = false;
    await renderResults('asha', { ...publicResults, events: [], news: [], chapters: [] });
    expect(screen.getByText(/no results for/i)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/sign in/i);
  });

  it('see the note before searching too (start screen)', async () => {
    authenticated = false;
    render(<SearchPage />);
    expect(await screen.findByRole('note')).toHaveTextContent(/public results only/i);
    expect(globalSearch).not.toHaveBeenCalled();
  });
});

describe('search page: states', () => {
  it('shows a start screen without calling the API when there is no query', () => {
    render(<SearchPage />);
    expect(screen.getByRole('heading', { level: 1, name: /search/i })).toBeInTheDocument();
    expect(globalSearch).not.toHaveBeenCalled();
  });

  it('does not search for a query that is too short', () => {
    query = 'a';
    render(<SearchPage />);
    expect(globalSearch).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument();
  });

  it('shows an error with a retry that searches again', async () => {
    query = 'pune';
    globalSearch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { data: memberResults } });
    render(<SearchPage />);
    const alert = await screen.findByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('link', { name: /Pune Meetup/ })).toBeInTheDocument();
    expect(globalSearch).toHaveBeenCalledTimes(2);
  });

  it('ignores a slow earlier response that arrives after a newer query', async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    globalSearch
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ data: { data: { ...memberResults, jobs: [], users: [] } } });

    query = 'first';
    const { rerender } = render(<SearchPage />);
    query = 'second';
    rerender(<SearchPage />);
    await screen.findByRole('link', { name: /Pune Meetup/ });

    resolveFirst({ data: { data: { ...memberResults, events: [{ id: 'old', title: 'Stale Event', startDate: '2099-01-01T00:00:00Z' }] } } });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Stale Event')).not.toBeInTheDocument();
  });
});
