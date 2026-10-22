import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/gallery',
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, unoptimized, alt, ...props }: any) => <img alt={alt} {...props} />,
}));

const authState = vi.hoisted(() => ({ user: null as any, isAuthenticated: false, isLoading: false }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const galleryApi = vi.hoisted(() => ({
  getAlbums: vi.fn(),
  getAlbum: vi.fn(),
  getRecentPhotos: vi.fn(),
  createAlbum: vi.fn(),
}));
const eventApi = vi.hoisted(() => ({ getEvents: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  galleryApi,
  eventApi,
}));

import GalleryPage from '@/app/(main)/gallery/page';

const ok = (data: unknown) => Promise.resolve({ data });
const ALBUM = {
  id: 'al1',
  title: 'Convocation 2025',
  description: 'Caps in the air',
  albumType: 'INSTITUTIONAL',
  coverPhotoUrl: '/cover.jpg',
  photoCount: 7,
  createdAt: '2025-06-01T00:00:00.000Z',
};

const signIn = (user: any) => {
  authState.user = user;
  authState.isAuthenticated = !!user;
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GalleryPage />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  Object.values(galleryApi).forEach((fn) => fn.mockReset());
  eventApi.getEvents.mockReset();
  toast.mockReset();
  signIn(null);
  galleryApi.getAlbums.mockImplementation(() =>
    ok({ success: true, data: [ALBUM], pagination: { page: 1, limit: 12, total: 1, totalPages: 1 } })
  );
  galleryApi.getRecentPhotos.mockImplementation(() => ok({ success: true, data: [] }));
});

describe('Gallery page', () => {
  it('shows album cover and photo count from the API fields', async () => {
    renderPage();
    expect(await screen.findByText('Convocation 2025')).toBeInTheDocument();
    expect(screen.getByAltText('Convocation 2025')).toHaveAttribute('src', '/cover.jpg');
    expect(screen.getByText('7 Photos')).toBeInTheDocument();
  });

  it('searches albums on the server (debounced) instead of filtering the loaded page', async () => {
    galleryApi.getAlbums.mockImplementation((_page: number, _limit: number, _type: unknown, search?: string) =>
      ok({
        success: true,
        data: search ? [{ ...ALBUM, id: 'al9', title: 'Reunion 2001', description: null }] : [ALBUM],
        pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
      })
    );
    renderPage();
    await screen.findByText('Convocation 2025');
    expect(galleryApi.getAlbums).toHaveBeenLastCalledWith(1, 12, undefined, undefined);

    await userEvent.type(screen.getByLabelText('Search albums'), '  reunion ');
    expect(await screen.findByText('Reunion 2001')).toBeInTheDocument();
    expect(galleryApi.getAlbums).toHaveBeenLastCalledWith(1, 12, undefined, 'reunion');
    expect(screen.queryByText('Convocation 2025')).not.toBeInTheDocument();
    // one request per settled term, not per keystroke
    expect(galleryApi.getAlbums.mock.calls.filter((c) => c[3] !== undefined).length).toBe(1);
  });

  it('shows a search-specific empty state', async () => {
    galleryApi.getAlbums.mockImplementation((_p: number, _l: number, _t: unknown, search?: string) =>
      ok({ success: true, data: search ? [] : [ALBUM], pagination: { page: 1, limit: 12, total: 0, totalPages: search ? 0 : 1 } })
    );
    renderPage();
    await screen.findByText('Convocation 2025');
    await userEvent.type(screen.getByLabelText('Search albums'), 'zzz');
    expect(await screen.findByText('No albums match "zzz"')).toBeInTheDocument();
  });

  it('loads more albums page by page', async () => {
    galleryApi.getAlbums.mockImplementation((page: number = 1) =>
      ok({
        success: true,
        data: [{ ...ALBUM, id: `al-p${page}`, title: `Album page ${page}` }],
        pagination: { page, limit: 12, total: 13, totalPages: 2 },
      })
    );
    renderPage();
    await screen.findByText('Album page 1');
    await userEvent.click(screen.getByRole('button', { name: 'Load more albums' }));
    expect(await screen.findByText('Album page 2')).toBeInTheDocument();
    expect(screen.getByText('Album page 1')).toBeInTheDocument();
    expect(galleryApi.getAlbums).toHaveBeenLastCalledWith(2, 12, undefined, undefined);
    expect(screen.queryByRole('button', { name: 'Load more albums' })).not.toBeInTheDocument();
  });

  it('shows an error state for albums with a retry', async () => {
    galleryApi.getAlbums.mockImplementation(() =>
      Promise.reject({ response: { status: 500, data: { success: false, error: { message: 'Albums unavailable' } } } })
    );
    renderPage();
    expect(await screen.findByText('Albums unavailable')).toBeInTheDocument();
    galleryApi.getAlbums.mockImplementation(() =>
      ok({ success: true, data: [ALBUM], pagination: { page: 1, limit: 12, total: 1, totalPages: 1 } })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Convocation 2025')).toBeInTheDocument();
  });

  it('asks anonymous visitors to sign in and offers no "New Album"', async () => {
    renderPage();
    await screen.findByText('Convocation 2025');
    expect(screen.getByRole('link', { name: /sign in to share/i })).toHaveAttribute('href', '/login?next=%2Fgallery');
    expect(screen.queryByRole('button', { name: /new album/i })).not.toBeInTheDocument();
  });

  it('hides "New Album" from members (album creation is admin-only)', async () => {
    signIn({ id: 'u1', role: 'MEMBER', userRole: 'MEMBER' });
    renderPage();
    await screen.findByText('Convocation 2025');
    expect(screen.queryByRole('button', { name: /new album/i })).not.toBeInTheDocument();
  });

  it('opens an album and shows its photos', async () => {
    galleryApi.getAlbum.mockImplementation(() =>
      ok({ success: true, data: { ...ALBUM, photos: [{ id: 'p1', url: '/p1.jpg', caption: 'Stage', createdAt: '2025-06-01' }] } })
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View album: Convocation 2025' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByAltText('Stage')).toHaveAttribute('src', '/p1.jpg');
    expect(galleryApi.getAlbum).toHaveBeenCalledWith('al1');
  });

  describe('admin album creation', () => {
    beforeEach(() => {
      signIn({ id: 'a1', role: 'ADMIN', userRole: 'ADMIN' });
      galleryApi.createAlbum.mockImplementation(() => ok({ success: true, data: { id: 'al2' } }));
    });

    it('validates and creates an institutional album, then refreshes the list', async () => {
      renderPage();
      await screen.findByText('Convocation 2025');
      await userEvent.click(screen.getByRole('button', { name: /new album/i }));
      const dialog = await screen.findByRole('dialog');

      await userEvent.click(within(dialog).getByRole('button', { name: 'Create album' }));
      expect(within(dialog).getByText('Title is required')).toBeInTheDocument();
      expect(galleryApi.createAlbum).not.toHaveBeenCalled();

      await userEvent.type(within(dialog).getByLabelText('Title'), '  Alumni Day  ');
      await userEvent.type(within(dialog).getByLabelText('Description (optional)'), 'Annual meet');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create album' }));

      await waitFor(() =>
        expect(galleryApi.createAlbum).toHaveBeenCalledWith({
          title: 'Alumni Day',
          description: 'Annual meet',
          albumType: 'INSTITUTIONAL',
        })
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Album created' }));
      await waitFor(() => expect(galleryApi.getAlbums).toHaveBeenCalledTimes(2));
    });

    it('requires a batch year for batch albums', async () => {
      renderPage();
      await screen.findByText('Convocation 2025');
      await userEvent.click(screen.getByRole('button', { name: /new album/i }));
      const dialog = await screen.findByRole('dialog');

      await userEvent.type(within(dialog).getByLabelText('Title'), 'Class of 2010');
      await userEvent.selectOptions(within(dialog).getByLabelText('Album type'), 'BATCH');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create album' }));
      expect(within(dialog).getByText('Enter a valid batch year')).toBeInTheDocument();

      await userEvent.type(within(dialog).getByLabelText('Batch year'), '2010');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create album' }));
      await waitFor(() =>
        expect(galleryApi.createAlbum).toHaveBeenCalledWith({ title: 'Class of 2010', albumType: 'BATCH', batchYear: 2010 })
      );
    });

    it('links event albums to a chosen event', async () => {
      eventApi.getEvents.mockImplementation(() =>
        ok({ success: true, data: [{ id: 'ev9', title: 'Homecoming', startDate: '2025-01-01' }], pagination: {} })
      );
      renderPage();
      await screen.findByText('Convocation 2025');
      await userEvent.click(screen.getByRole('button', { name: /new album/i }));
      const dialog = await screen.findByRole('dialog');

      await userEvent.type(within(dialog).getByLabelText('Title'), 'Homecoming photos');
      await userEvent.selectOptions(within(dialog).getByLabelText('Album type'), 'EVENT');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create album' }));
      expect(within(dialog).getByText('Choose an event')).toBeInTheDocument();

      await within(dialog).findByRole('option', { name: /Homecoming/ });
      await userEvent.selectOptions(within(dialog).getByLabelText('Event'), 'ev9');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create album' }));
      await waitFor(() =>
        expect(galleryApi.createAlbum).toHaveBeenCalledWith({ title: 'Homecoming photos', albumType: 'EVENT', eventId: 'ev9' })
      );
    });

    it('keeps the dialog open and shows the server error', async () => {
      galleryApi.createAlbum.mockImplementation(() =>
        Promise.reject({ response: { status: 400, data: { success: false, error: { message: 'Album title is required' } } } })
      );
      renderPage();
      await screen.findByText('Convocation 2025');
      await userEvent.click(screen.getByRole('button', { name: /new album/i }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText('Title'), 'x');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create album' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Album title is required');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
