/**
 * ROUND 2 (client) - the search UI with hostile data: the query echoed in the heading, titles, excerpts, slugs and
 * photo URLs coming back from the API. React escapes text; this pins that no link or image source can be turned into
 * script, and that a slow earlier search can never overwrite a newer one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

let query = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams(query ? `q=${encodeURIComponent(query)}` : ''),
}));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false, user: { id: 'me' } }),
}));
const globalSearch = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<any>('@/lib/api');
  return { ...actual, searchApi: { globalSearch: (...args: unknown[]) => globalSearch(...args) } };
});

import SearchPage from '@/app/(main)/search/page';

const EVIL_TEXT = '<img src=x onerror="window.__pwned=1">';

beforeEach(() => {
  globalSearch.mockReset();
  query = '';
  (window as unknown as { __pwned?: number }).__pwned = undefined;
});

describe('hostile query and result data', () => {
  it('echoes the query as text and never creates elements from it', async () => {
    query = EVIL_TEXT;
    globalSearch.mockResolvedValue({ data: { data: { scope: 'member', users: [], jobs: [], events: [], news: [], chapters: [], posts: [] } } });
    const { container } = render(<SearchPage />);
    await waitFor(() => expect(globalSearch).toHaveBeenCalled());
    expect(container.querySelector('h1 img')).toBeNull();
    expect(container.querySelector('img[src="x"]')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('<img');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('renders hostile titles, excerpts, slugs and avatars without producing script-capable links or sources', async () => {
    query = 'hostile';
    globalSearch.mockResolvedValue({
      data: {
        data: {
          scope: 'member',
          users: [{ id: 'u1', fullName: EVIL_TEXT, currentDesignation: EVIL_TEXT, batchYear: 2015, department: 'x', profilePhotoUrl: 'javascript:alert(1)' }],
          jobs: [{ id: 'j1', title: EVIL_TEXT, company: EVIL_TEXT }],
          events: [{ id: 'e1', title: EVIL_TEXT, startDate: '2099-03-01T10:00:00Z', eventType: 'OFFLINE' }],
          news: [
            { id: 'n1', title: EVIL_TEXT, slug: 'javascript:alert(1)', excerpt: EVIL_TEXT },
            { id: 'n2', title: 'Slash slug', slug: '/evil.example', excerpt: 'x' },
            { id: 'n3', title: 'Dots slug', slug: '../../admin', excerpt: 'x' },
            { id: 'n4', title: 'Quote slug', slug: 'a" onmouseover="alert(1)', excerpt: 'x' },
          ],
          chapters: [{ id: 'c1', name: EVIL_TEXT, region: EVIL_TEXT, memberCount: 3 }],
          posts: [{ id: 'p1', content: `${EVIL_TEXT} https://example.com javascript:alert(1)`, user: { id: 'u1', fullName: EVIL_TEXT } }],
        },
      },
    });
    const { container } = render(<SearchPage />);
    await waitFor(() => expect(screen.queryByText(/searching/i)).not.toBeInTheDocument());
    await act(async () => undefined);

    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(container.querySelectorAll('[onmouseover]')).toHaveLength(0);
    for (const a of Array.from(container.querySelectorAll('a'))) {
      const href = a.getAttribute('href') ?? '';
      expect(href).not.toMatch(/^\s*(javascript|data|vbscript):/i);
      // every result link is an in-app path; nothing may leave the site or become protocol-relative
      expect(href.startsWith('/')).toBe(true);
      expect(href.startsWith('//')).toBe(false);
    }
    for (const img of Array.from(container.querySelectorAll('img'))) {
      expect(img.getAttribute('src') ?? '').not.toMatch(/^\s*(javascript|data|vbscript):/i);
    }
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('a slow earlier search can never overwrite the results of a newer one', async () => {
    let finishFirst: (value: unknown) => void = () => undefined;
    globalSearch.mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)));
    query = 'first';
    const { rerender } = render(<SearchPage />);
    await waitFor(() => expect(globalSearch).toHaveBeenCalledWith('first'));

    globalSearch.mockResolvedValueOnce({
      data: { data: { scope: 'member', users: [], jobs: [], events: [], chapters: [], posts: [], news: [{ id: 'n2', title: 'Newer result', slug: 'newer' }] } },
    });
    query = 'second';
    rerender(<SearchPage />);
    await screen.findByText('Newer result');

    await act(async () => {
      finishFirst({ data: { data: { scope: 'member', users: [], jobs: [], events: [], chapters: [], posts: [], news: [{ id: 'n1', title: 'Stale result', slug: 'stale' }] } } });
    });
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument();
    expect(screen.getByText('Newer result')).toBeInTheDocument();
  });
});
