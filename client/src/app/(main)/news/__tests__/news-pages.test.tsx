import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';

// Anonymous viewer: these pages must work without auth.
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: null, isLoading: false, isAuthenticated: false }),
}));

const params: { slug?: string } = {};
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => params,
  usePathname: () => '/news',
}));

const newsApi = vi.hoisted(() => ({
  getArticles: vi.fn(),
  getArticle: vi.fn(),
  getLatest: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  newsApi,
}));

import NewsPage from '@/app/(main)/news/page';
import NewsArticlePage from '@/app/(main)/news/[slug]/page';

const ok = (data: unknown) => Promise.resolve({ data });

const article = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Reunion 2026 recap',
  slug: 'reunion-2026-recap',
  excerpt: 'Highlights from the reunion',
  content: '<p>First paragraph.</p><p>Second <strong>paragraph</strong>.</p><script>window.__pwned = true</script>',
  featuredImage: null,
  authorId: 'u1',
  author: { id: 'u1', fullName: 'Editorial Team', profilePhotoUrl: null, currentDesignation: 'Alumni Office' },
  category: 'EVENT_RECAP',
  status: 'PUBLISHED',
  readingTime: 3,
  viewCount: 42,
  publishedAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-08-30T10:00:00.000Z',
  ...overrides,
});

const renderPage = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

beforeEach(() => {
  Object.values(newsApi).forEach((fn) => fn.mockReset());
  newsApi.getLatest.mockImplementation(() =>
    ok({ success: true, data: [article(), article({ id: 'a2', slug: 'new-lab', title: 'New lab opens', category: 'INSTITUTE_UPDATE' })] })
  );
});

describe('News list page', () => {
  it('renders articles from the API and links to /news/:slug', async () => {
    newsApi.getArticles.mockImplementation(() =>
      ok({
        success: true,
        data: [article(), article({ id: 'a2', slug: 'new-lab', title: 'New lab opens', category: 'INSTITUTE_UPDATE' })],
        pagination: { page: 1, limit: 12, total: 2, totalPages: 1 },
      })
    );
    renderPage(<NewsPage />);

    expect(await screen.findByRole('heading', { name: 'Reunion 2026 recap' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /read full story/i })).toHaveAttribute('href', '/news/reunion-2026-recap');
    expect(screen.getByRole('link', { name: 'Read more: New lab opens' })).toHaveAttribute('href', '/news/new-lab');
    expect(screen.getByText('Institute Update')).toBeInTheDocument();
    expect(newsApi.getArticles).toHaveBeenCalledWith({ page: 1, limit: 12, category: undefined, search: undefined });
    expect(document.querySelector('a[href^="/dashboard/news"]')).toBeNull();
  });

  it('searches on the server (debounced) and resets to page 1', async () => {
    newsApi.getArticles.mockImplementation((p: { page: number; search?: string }) =>
      ok({
        success: true,
        data: p.search
          ? [article({ id: 'a9', slug: 'gala', title: 'Gala night' })]
          : [article(), article({ id: 'a2', slug: 'new-lab', title: 'New lab opens' })],
        pagination: { page: p.page, limit: 12, total: 30, totalPages: p.search ? 1 : 3 },
      })
    );
    renderPage(<NewsPage />);
    await screen.findByRole('heading', { name: 'Reunion 2026 recap' });

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(newsApi.getArticles).toHaveBeenLastCalledWith({ page: 2, limit: 12, category: undefined, search: undefined }));

    await userEvent.type(screen.getByRole('textbox', { name: 'Search articles' }), '  gala ');
    // The page must not filter the loaded page client-side any more; it asks the server.
    expect(await screen.findByRole('heading', { name: 'Gala night' })).toBeInTheDocument();
    expect(newsApi.getArticles).toHaveBeenLastCalledWith({ page: 1, limit: 12, category: undefined, search: 'gala' });
    // Debounced: no request per keystroke.
    const searchCalls = newsApi.getArticles.mock.calls.filter(([p]) => p.search);
    expect(searchCalls).toHaveLength(1);
  });

  it('shows an empty state when there are no articles', async () => {
    newsApi.getArticles.mockImplementation(() =>
      ok({ success: true, data: [], pagination: { page: 1, limit: 12, total: 0, totalPages: 0 } })
    );
    renderPage(<NewsPage />);
    expect(await screen.findByText('No articles found')).toBeInTheDocument();
  });

  it('shows the API error message', async () => {
    newsApi.getArticles.mockImplementation(() =>
      Promise.reject({ response: { status: 500, data: { success: false, error: { message: 'News is unavailable' } } } })
    );
    renderPage(<NewsPage />);
    expect(await screen.findByText('News is unavailable')).toBeInTheDocument();
  });
});

describe('News article page', () => {
  beforeEach(() => {
    params.slug = 'reunion-2026-recap';
  });

  it('renders the article as plain text paragraphs with metadata and latest news', async () => {
    newsApi.getArticle.mockImplementation(() => ok({ success: true, data: article() }));
    renderPage(<NewsArticlePage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Reunion 2026 recap' })).toBeInTheDocument();
    expect(newsApi.getArticle).toHaveBeenCalledWith('reunion-2026-recap');

    const body = screen.getByTestId('article-body');
    const paragraphs = Array.from(body.querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs).toEqual(['First paragraph.', 'Second paragraph.']);
    expect(body.querySelector('script, strong')).toBeNull();
    expect((window as any).__pwned).toBeUndefined();

    expect(screen.getByText('Editorial Team')).toBeInTheDocument();
    expect(screen.getByText('3 min read')).toBeInTheDocument();
    expect(screen.getByText('42 views')).toBeInTheDocument();
    expect(screen.getByText('Event Recap')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /back to news/i })[0]).toHaveAttribute('href', '/news');

    // Latest news excludes the current article.
    const related = await screen.findByRole('link', { name: /new lab opens/i });
    expect(related).toHaveAttribute('href', '/news/new-lab');
    expect(screen.queryAllByRole('link', { name: /reunion 2026 recap/i })).toHaveLength(0);
  });

  it('shows a not-found state for unknown slugs without retrying', async () => {
    params.slug = 'missing';
    newsApi.getArticle.mockImplementation(() =>
      Promise.reject({ response: { status: 404, data: { success: false, error: { message: 'Article not found' } } } })
    );
    renderPage(<NewsArticlePage />);

    expect(await screen.findByRole('heading', { name: 'Article not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to News' })).toHaveAttribute('href', '/news');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    await waitFor(() => expect(newsApi.getArticle).toHaveBeenCalledTimes(1));
    expect(newsApi.getLatest).not.toHaveBeenCalled();
  });

  it('shows other errors with a retry button', async () => {
    newsApi.getArticle.mockImplementation(() =>
      Promise.reject({ response: { status: 500, data: { success: false, error: { message: 'Server exploded' } } } })
    );
    renderPage(<NewsArticlePage />);
    // Non-404 errors are retried once (~1s backoff) before the error shows.
    expect(await screen.findByText('Server exploded', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('labels draft previews for admins', async () => {
    newsApi.getArticle.mockImplementation(() => ok({ success: true, data: article({ status: 'DRAFT', publishedAt: null }) }));
    renderPage(<NewsArticlePage />);
    expect(await screen.findByText('Draft preview')).toBeInTheDocument();
  });
});
