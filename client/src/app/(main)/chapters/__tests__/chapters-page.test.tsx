import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const authState: { user: any; isLoading: boolean; isAuthenticated: boolean } = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
};
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const params: { id?: string } = {};
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useParams: () => params,
  usePathname: () => '/chapters',
}));

const chapterApi = vi.hoisted(() => ({
  getChapters: vi.fn(),
  getChapter: vi.fn(),
  getMyChapters: vi.fn(),
  joinChapter: vi.fn(),
  leaveChapter: vi.fn(),
  getMembers: vi.fn(),
  createChapter: vi.fn(),
  updateChapter: vi.fn(),
  assignAdmin: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  chapterApi,
}));

import ChaptersPage from '@/app/(main)/chapters/page';
import ChapterDetailPage from '@/app/(main)/chapters/[id]/page';

const ok = (data: unknown) => Promise.resolve({ data });

const CHAPTERS = [
  {
    id: 'c1',
    name: 'Delhi NCR',
    region: 'North India',
    description: 'Alumni in the capital region',
    adminUserId: 'admin-1',
    admin: { id: 'admin-1', fullName: 'Asha Rao' },
    memberCount: 3,
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    _count: { memberships: 12, events: 2 },
  },
  {
    id: 'c2',
    name: 'Bay Area',
    region: 'USA',
    description: null,
    adminUserId: null,
    admin: null,
    memberCount: 1,
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    _count: { memberships: 1, events: 0 },
  },
];

const renderPage = (ui: React.ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
};

const setUser = (user: any) => {
  authState.user = user;
  authState.isAuthenticated = !!user;
};

const cardFor = async (name: string) => {
  const link = await screen.findByRole('link', { name });
  return link.closest('[data-testid="chapter-card"]') as HTMLElement;
};

beforeEach(() => {
  Object.values(chapterApi).forEach((fn) => fn.mockReset());
  toast.mockReset();
  setUser({ id: 'u1', fullName: 'Member', role: 'MEMBER', userRole: 'MEMBER' });
  chapterApi.getChapters.mockImplementation(() =>
    ok({ success: true, data: CHAPTERS, pagination: { page: 1, limit: 100, total: 2, totalPages: 1 } })
  );
  chapterApi.getMyChapters.mockImplementation(() => ok({ success: true, data: [{ ...CHAPTERS[1], joinedAt: '2025-02-01' }] }));
  chapterApi.joinChapter.mockImplementation(() => ok({ success: true, data: { message: 'Joined' } }));
  chapterApi.leaveChapter.mockImplementation(() => ok({ success: true, data: { message: 'Left' } }));
});

describe('Chapters list page', () => {
  it('renders chapters with member counts, admin names and membership state', async () => {
    renderPage(<ChaptersPage />);

    const delhi = await cardFor('Delhi NCR');
    expect(within(delhi).getByText('12 members')).toBeInTheDocument();
    expect(within(delhi).getByText('Admin: Asha Rao')).toBeInTheDocument();
    expect(within(delhi).getByText('North India')).toBeInTheDocument();
    expect(await within(delhi).findByRole('button', { name: 'Join Delhi NCR' })).toBeEnabled();

    const bay = await cardFor('Bay Area');
    expect(within(bay).getByText('1 member')).toBeInTheDocument();
    expect(within(bay).getByText('No chapter admin yet')).toBeInTheDocument();
    expect(await within(bay).findByRole('button', { name: 'Leave Bay Area' })).toBeInTheDocument();
    expect(within(bay).getByText('Member')).toBeInTheDocument();

    expect(chapterApi.getChapters).toHaveBeenCalledWith(1, 24, { search: undefined, region: undefined });
    expect(within(delhi).getByRole('link', { name: 'View' })).toHaveAttribute('href', '/chapters/c1');
  });

  it('joins a chapter and refreshes memberships', async () => {
    renderPage(<ChaptersPage />);
    const delhi = await cardFor('Delhi NCR');
    await userEvent.click(await within(delhi).findByRole('button', { name: 'Join Delhi NCR' }));

    await waitFor(() => expect(chapterApi.joinChapter).toHaveBeenCalledWith('c1'));
    expect(chapterApi.leaveChapter).not.toHaveBeenCalled();
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Joined chapter' })));
    await waitFor(() => expect(chapterApi.getMyChapters).toHaveBeenCalledTimes(2));
  });

  it('leaves a chapter the user belongs to', async () => {
    renderPage(<ChaptersPage />);
    const bay = await cardFor('Bay Area');
    await userEvent.click(await within(bay).findByRole('button', { name: 'Leave Bay Area' }));
    await waitFor(() => expect(chapterApi.leaveChapter).toHaveBeenCalledWith('c2'));
    expect(chapterApi.joinChapter).not.toHaveBeenCalled();
  });

  it('shows the server error when joining fails', async () => {
    chapterApi.joinChapter.mockImplementation(() =>
      Promise.reject({ response: { status: 409, data: { success: false, error: { message: 'Already a member of this chapter' } } } })
    );
    renderPage(<ChaptersPage />);
    const delhi = await cardFor('Delhi NCR');
    await userEvent.click(await within(delhi).findByRole('button', { name: 'Join Delhi NCR' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive', description: 'Already a member of this chapter' })
      )
    );
  });

  it('searches on the server (debounced) and shows an empty state', async () => {
    chapterApi.getChapters.mockImplementation((_page: number, _limit: number, f: { search?: string } = {}) => {
      const data = !f.search ? CHAPTERS : f.search === 'capital' ? [CHAPTERS[0]] : [];
      return ok({ success: true, data, pagination: { page: 1, limit: 24, total: data.length, totalPages: 1 } });
    });
    renderPage(<ChaptersPage />);
    await cardFor('Delhi NCR');
    const search = screen.getByRole('textbox', { name: 'Search chapters' });

    await userEvent.type(search, 'capital');
    await waitFor(() => expect(chapterApi.getChapters).toHaveBeenLastCalledWith(1, 24, { search: 'capital', region: undefined }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Bay Area' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Delhi NCR' })).toBeInTheDocument();
    expect(chapterApi.getChapters.mock.calls.filter(([, , f]) => f?.search)).toHaveLength(1);

    await userEvent.clear(search);
    await userEvent.type(search, 'nowhere');
    expect(await screen.findByText('No chapters match your filters')).toBeInTheDocument();
  });

  it('offers the server-provided regions and filters by region on the server', async () => {
    chapterApi.getChapters.mockImplementation((_page: number, _limit: number, f: { region?: string } = {}) => {
      const data = f.region ? CHAPTERS.filter((c) => c.region === f.region) : CHAPTERS;
      return ok({
        success: true,
        data,
        regions: ['North India', 'USA', 'West India'],
        pagination: { page: 1, limit: 24, total: data.length, totalPages: 1 },
      });
    });
    renderPage(<ChaptersPage />);
    await cardFor('Delhi NCR');

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter by region' }));
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    // "West India" has no chapter on this page; it comes from the server's region list.
    expect(options).toEqual(['All regions', 'North India', 'USA', 'West India']);
    await userEvent.click(screen.getByRole('option', { name: 'USA' }));

    await waitFor(() => expect(chapterApi.getChapters).toHaveBeenLastCalledWith(1, 24, { search: undefined, region: 'USA' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Delhi NCR' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Bay Area' })).toBeInTheDocument();
  });

  it('shows loading skeletons, then an error with retry', async () => {
    let reject!: (e: unknown) => void;
    chapterApi.getChapters.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    renderPage(<ChaptersPage />);
    expect(screen.getAllByTestId('chapter-skeleton').length).toBeGreaterThan(0);

    reject({ response: { status: 500, data: { success: false, error: { message: 'Database unavailable' } } } });
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Delhi NCR' })).toBeInTheDocument();
  });

  it('hides "Create chapter" from members', async () => {
    renderPage(<ChaptersPage />);
    await cardFor('Delhi NCR');
    expect(screen.queryByRole('button', { name: /create chapter/i })).not.toBeInTheDocument();
  });

  it('lets admins create a chapter', async () => {
    setUser({ id: 'a1', fullName: 'Admin', role: 'ADMIN', userRole: 'ADMIN' });
    chapterApi.createChapter.mockImplementation(() => ok({ success: true, data: { id: 'c3' } }));
    renderPage(<ChaptersPage />);
    await cardFor('Delhi NCR');

    await userEvent.click(screen.getByRole('button', { name: /create chapter/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create chapter' }));
    expect(within(dialog).getByText('Name is required')).toBeInTheDocument();
    expect(chapterApi.createChapter).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByLabelText('Name'), '  Pune  ');
    await userEvent.type(within(dialog).getByLabelText('Region'), 'West India');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create chapter' }));

    await waitFor(() =>
      expect(chapterApi.createChapter).toHaveBeenCalledWith({
        name: 'Pune',
        region: 'West India',
        description: undefined,
        logoUrl: undefined,
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('asks anonymous visitors to sign in instead of calling member endpoints', async () => {
    setUser(null);
    renderPage(<ChaptersPage />);
    const delhi = await cardFor('Delhi NCR');
    expect(within(delhi).getByRole('link', { name: 'Sign in to join' })).toHaveAttribute('href', '/login');
    expect(chapterApi.getMyChapters).not.toHaveBeenCalled();
  });
});

describe('Chapter detail page', () => {
  const DETAIL = {
    ...CHAPTERS[0],
    admin: { id: 'admin-1', fullName: 'Asha Rao', currentDesignation: 'Engineer' },
    events: [{ id: 'e1', title: 'Winter Meetup', startDate: '2030-01-10T10:00:00.000Z', city: 'Delhi' }],
  };

  beforeEach(() => {
    params.id = 'c1';
    chapterApi.getChapter.mockImplementation(() => ok({ success: true, data: DETAIL }));
    chapterApi.getMembers.mockImplementation(() =>
      ok({
        success: true,
        data: [{ id: 'm1', fullName: 'Ravi Kumar', batchYear: 2015, joinedAt: '2025-01-01' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      })
    );
  });

  it('renders description, upcoming events, admin and members', async () => {
    renderPage(<ChapterDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Delhi NCR' })).toBeInTheDocument();
    expect(screen.getByText('Alumni in the capital region')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Winter Meetup' })[0]).toHaveAttribute('href', '/events/e1');
    expect(screen.getByText('Asha Rao').closest('a')).toHaveAttribute('href', '/profile/admin-1');
    expect(await screen.findByText('Ravi Kumar')).toBeInTheDocument();
    expect(chapterApi.getMembers).toHaveBeenCalledWith('c1', 1, 20);
    expect(screen.queryByRole('button', { name: /edit chapter/i })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Join chapter' }));
    await waitFor(() => expect(chapterApi.joinChapter).toHaveBeenCalledWith('c1'));
  });

  it("lets the chapter's admin edit it", async () => {
    setUser({ id: 'admin-1', fullName: 'Asha', role: 'CHAPTER_ADMIN', userRole: 'CHAPTER_ADMIN' });
    chapterApi.updateChapter.mockImplementation(() => ok({ success: true, data: {} }));
    renderPage(<ChapterDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: /edit chapter/i }));
    const dialog = await screen.findByRole('dialog');
    const description = within(dialog).getByLabelText('Description (optional)');
    expect(description).toHaveValue('Alumni in the capital region');
    await userEvent.clear(description);
    await userEvent.type(description, 'New text');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(chapterApi.updateChapter).toHaveBeenCalledWith('c1', {
        name: 'Delhi NCR',
        region: 'North India',
        description: 'New text',
        logoUrl: undefined,
      })
    );
  });

  it('hides the edit button from chapter admins of other chapters', async () => {
    setUser({ id: 'someone-else', role: 'CHAPTER_ADMIN', userRole: 'CHAPTER_ADMIN' });
    renderPage(<ChapterDetailPage />);
    await screen.findByRole('heading', { name: 'Delhi NCR' });
    expect(screen.queryByRole('button', { name: /edit chapter/i })).not.toBeInTheDocument();
  });

  it('shows a not-found state for unknown chapters', async () => {
    chapterApi.getChapter.mockImplementation(() =>
      Promise.reject({ response: { status: 404, data: { success: false, error: { message: 'Chapter not found' } } } })
    );
    renderPage(<ChapterDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Chapter not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Chapters' })).toHaveAttribute('href', '/chapters');
    expect(chapterApi.getMembers).not.toHaveBeenCalled();
  });
});
