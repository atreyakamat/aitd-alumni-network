import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/marketplace',
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, unoptimized, alt, ...props }: any) => <img alt={alt} {...props} />,
}));

const authState = vi.hoisted(() => ({
  user: { id: 'me', fullName: 'Me Member', userRole: 'MEMBER', role: 'MEMBER' } as any,
  isAuthenticated: true,
  isLoading: false,
}));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const marketplaceApi = vi.hoisted(() => ({
  getListings: vi.fn(),
  getListing: vi.fn(),
  getCategories: vi.fn(),
  getMyListings: vi.fn(),
  createListing: vi.fn(),
  updateListing: vi.fn(),
  deleteListing: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  marketplaceApi,
}));

import MarketplacePage from '@/app/(main)/marketplace/page';

const ok = (data: unknown) => Promise.resolve({ data });
const owner = { id: 'u2', fullName: 'Priya Alum', batchYear: 2012, profilePhotoUrl: null };
const OTHER = {
  id: 'l1',
  userId: 'u2',
  type: 'SERVICE',
  title: 'Tax filing help',
  category: 'Finance',
  description: 'Personal and small-business tax filing by an alum CA.',
  location: 'Pune',
  website: 'https://tax.example.com',
  contactInfo: 'priya@tax.example.com',
  priceRange: 'From INR 1,500',
  isActive: true,
  isFeatured: true,
  viewCount: 4,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  user: owner,
};
const MINE = {
  ...OTHER,
  id: 'l2',
  userId: 'me',
  type: 'BUSINESS',
  title: 'Alumni Cafe',
  category: 'Food',
  description: 'Coffee and snacks near campus for alumni meetups.',
  website: null,
  contactInfo: null,
  priceRange: null,
  isFeatured: false,
  user: { id: 'me', fullName: 'Me Member' },
};

const page = (items: unknown[], extra: Record<string, unknown> = {}) =>
  ok({ success: true, data: items, pagination: { page: 1, limit: 12, total: items.length, totalPages: 1, ...extra } });

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MarketplacePage />
    </QueryClientProvider>
  );
};

const lastListParams = () => marketplaceApi.getListings.mock.calls.at(-1)?.[0];

beforeEach(() => {
  Object.values(marketplaceApi).forEach((fn) => fn.mockReset());
  toast.mockReset();
  marketplaceApi.getListings.mockImplementation(() => page([OTHER, MINE]));
  marketplaceApi.getCategories.mockImplementation(() =>
    ok({ success: true, data: [{ name: 'Finance', count: 1 }, { name: 'Food', count: 1 }] })
  );
  marketplaceApi.getMyListings.mockImplementation(() => ok({ success: true, data: [{ ...MINE, user: undefined }] }));
  marketplaceApi.getListing.mockImplementation((id: string) => ok({ success: true, data: id === 'l2' ? MINE : OTHER }));
});

describe('Marketplace page — browse', () => {
  it('renders listings from the server model', async () => {
    renderPage();
    expect(await screen.findByText('Tax filing help')).toBeInTheDocument();
    expect(screen.getByText('Alumni Cafe')).toBeInTheDocument();
    expect(screen.getByText('From INR 1,500')).toBeInTheDocument();
    expect(screen.getByText('Featured')).toBeInTheDocument();
    expect(lastListParams()).toEqual({ page: 1, limit: 12 });
  });

  it('maps type, category and search filters to API params and resets to page 1', async () => {
    marketplaceApi.getListings.mockImplementation(() => page([OTHER], { total: 30, totalPages: 3 }));
    renderPage();
    await screen.findByText('Tax filing help');

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastListParams()).toEqual({ page: 2, limit: 12 }));

    await userEvent.click(screen.getByRole('button', { name: 'Services' }));
    await waitFor(() => expect(lastListParams()).toEqual({ page: 1, limit: 12, type: 'SERVICE' }));
    expect(screen.getByRole('button', { name: 'Services' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(await screen.findByRole('button', { name: /^Finance/ }));
    await waitFor(() => expect(lastListParams()).toEqual({ page: 1, limit: 12, type: 'SERVICE', category: 'Finance' }));

    await userEvent.type(screen.getByLabelText('Search listings'), '  tax  ');
    await waitFor(() =>
      expect(lastListParams()).toEqual({ page: 1, limit: 12, type: 'SERVICE', category: 'Finance', search: 'tax' })
    );
  });

  it('shows an empty state', async () => {
    marketplaceApi.getListings.mockImplementation(() => page([]));
    renderPage();
    expect(await screen.findByText('No listings found')).toBeInTheDocument();
  });

  it('shows the server error with a retry', async () => {
    marketplaceApi.getListings.mockImplementation(() =>
      Promise.reject({ response: { status: 500, data: { success: false, error: { message: 'Database unavailable' } } } })
    );
    renderPage();
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument();
    marketplaceApi.getListings.mockImplementation(() => page([OTHER]));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Tax filing help')).toBeInTheDocument();
  });

  it("shows another member's contact details and website but no edit/delete", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View details: Tax filing help' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('priya@tax.example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('Priya Alum')).toBeInTheDocument();
    const site = within(dialog).getByRole('link', { name: /visit website/i });
    expect(site).toHaveAttribute('href', 'https://tax.example.com');
    expect(site).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(within(dialog).getByRole('link', { name: /message/i })).toHaveAttribute('href', '/messages?u=u2');
    expect(within(dialog).queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(marketplaceApi.getListing).toHaveBeenCalledWith('l1');
  });

  it('offers edit only on my own listing in the detail view', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View details: Alumni Cafe' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('button', { name: 'Edit listing' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /message/i })).not.toBeInTheDocument();
  });

  it('never renders a non-http website as a link', async () => {
    marketplaceApi.getListing.mockImplementation(() => ok({ success: true, data: { ...OTHER, website: 'javascript:alert(1)' } }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View details: Tax filing help' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('priya@tax.example.com');
    expect(within(dialog).queryByRole('link', { name: /visit website/i })).not.toBeInTheDocument();
  });
});

describe('Marketplace page — create', () => {
  it('validates and creates a listing with the server payload', async () => {
    marketplaceApi.createListing.mockImplementation(() => ok({ success: true, data: { id: 'l9' } }));
    renderPage();
    await screen.findByText('Tax filing help');
    await userEvent.click(screen.getByRole('button', { name: /list your business or service/i }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish listing' }));
    expect(within(dialog).getByText('Title must be at least 3 characters')).toBeInTheDocument();
    expect(marketplaceApi.createListing).not.toHaveBeenCalled();

    await userEvent.selectOptions(within(dialog).getByLabelText('Listing type'), 'SERVICE');
    await userEvent.type(within(dialog).getByLabelText('Title'), '  Resume reviews  ');
    await userEvent.type(within(dialog).getByLabelText('Category'), 'Careers');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Detailed resume reviews by a hiring manager.');
    await userEvent.type(within(dialog).getByLabelText('Website (optional)'), 'https://resume.example.com');
    await userEvent.type(within(dialog).getByLabelText('Price range (optional)'), 'Free for students');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish listing' }));

    await waitFor(() =>
      expect(marketplaceApi.createListing).toHaveBeenCalledWith({
        type: 'SERVICE',
        title: 'Resume reviews',
        category: 'Careers',
        description: 'Detailed resume reviews by a hiring manager.',
        website: 'https://resume.example.com',
        priceRange: 'Free for students',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing published' }));
  });

  it('keeps the dialog open with server field errors', async () => {
    marketplaceApi.createListing.mockImplementation(() =>
      Promise.reject({
        response: {
          status: 400,
          data: {
            success: false,
            error: {
              message: 'Validation failed',
              code: 'VALIDATION_ERROR',
              details: [{ field: 'body.website', message: 'Website must be an http(s) URL' }],
            },
          },
        },
      })
    );
    renderPage();
    await screen.findByText('Tax filing help');
    await userEvent.click(screen.getByRole('button', { name: /list your business or service/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Resume reviews');
    await userEvent.type(within(dialog).getByLabelText('Category'), 'Careers');
    await userEvent.type(within(dialog).getByLabelText('Description'), 'Detailed resume reviews by a hiring manager.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publish listing' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Validation failed');
    expect(within(dialog).getByText('Website must be an http(s) URL')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Marketplace page — my listings', () => {
  const openMyListings = async () => {
    renderPage();
    await screen.findByText('Tax filing help');
    await userEvent.click(screen.getByRole('tab', { name: /my listings/i }));
    return screen.findByRole('tabpanel');
  };

  it('lists only my listings with lifecycle actions', async () => {
    const panel = await openMyListings();
    expect(await within(panel).findByText('Alumni Cafe')).toBeInTheDocument();
    expect(within(panel).queryByText('Tax filing help')).not.toBeInTheDocument();
    expect(within(panel).getByText('Active')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Edit Alumni Cafe' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Delete Alumni Cafe' })).toBeInTheDocument();
  });

  it('edits my listing with a prefilled form', async () => {
    marketplaceApi.updateListing.mockImplementation(() => ok({ success: true, data: MINE }));
    const panel = await openMyListings();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Edit Alumni Cafe' }));
    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getByLabelText('Title');
    expect(title).toHaveValue('Alumni Cafe');
    await userEvent.clear(title);
    await userEvent.type(title, 'Alumni Cafe & Bakery');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(marketplaceApi.updateListing).toHaveBeenCalledWith('l2', {
        type: 'BUSINESS',
        title: 'Alumni Cafe & Bakery',
        category: 'Food',
        description: 'Coffee and snacks near campus for alumni meetups.',
        location: 'Pune',
        website: null,
        contactInfo: null,
        priceRange: null,
      })
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing updated' }));
  });

  it('pauses an active listing', async () => {
    marketplaceApi.updateListing.mockImplementation(() => ok({ success: true, data: { ...MINE, isActive: false } }));
    const panel = await openMyListings();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Pause Alumni Cafe' }));
    await waitFor(() => expect(marketplaceApi.updateListing).toHaveBeenCalledWith('l2', { isActive: false }));
  });

  it('deletes only after confirming in a dialog', async () => {
    marketplaceApi.deleteListing.mockImplementation(() => ok({ success: true, data: { message: 'Listing deleted' } }));
    const confirmSpy = vi.spyOn(window, 'confirm');
    const panel = await openMyListings();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Delete Alumni Cafe' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/permanently remove "Alumni Cafe"/i)).toBeInTheDocument();
    expect(marketplaceApi.deleteListing).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete listing' }));
    await waitFor(() => expect(marketplaceApi.deleteListing).toHaveBeenCalledWith('l2'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Listing deleted' }));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('shows the delete error and keeps the dialog open', async () => {
    marketplaceApi.deleteListing.mockImplementation(() =>
      Promise.reject({ response: { status: 403, data: { success: false, error: { message: 'Not authorized to delete this listing' } } } })
    );
    const panel = await openMyListings();
    await userEvent.click(await within(panel).findByRole('button', { name: 'Delete Alumni Cafe' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete listing' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Not authorized to delete this listing');
  });

  it('shows an empty state when I have no listings', async () => {
    marketplaceApi.getMyListings.mockImplementation(() => ok({ success: true, data: [] }));
    const panel = await openMyListings();
    expect(await within(panel).findByText("You haven't listed anything yet")).toBeInTheDocument();
  });
});

describe('Marketplace page — admin moderation', () => {
  beforeEach(() => {
    authState.user = { id: 'admin1', fullName: 'Ada Admin', userRole: 'ADMIN', role: 'ADMIN' };
  });
  afterEach(() => {
    authState.user = { id: 'me', fullName: 'Me Member', userRole: 'MEMBER', role: 'MEMBER' };
  });

  it("lets admins unfeature and remove someone else's listing (but not edit it)", async () => {
    marketplaceApi.updateListing.mockImplementation(() => ok({ success: true }));
    marketplaceApi.deleteListing.mockImplementation(() => ok({ success: true }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View details: Tax filing help' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('button', { name: 'Edit listing' })).not.toBeInTheDocument();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Unfeature' }));
    await waitFor(() => expect(marketplaceApi.updateListing).toHaveBeenCalledWith('l1', { isFeatured: false }));

    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove listing' }));
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete listing' }));
    await waitFor(() => expect(marketplaceApi.deleteListing).toHaveBeenCalledWith('l1'));
  });

  it('shows no moderation actions to members', async () => {
    authState.user = { id: 'me', fullName: 'Me Member', userRole: 'MEMBER', role: 'MEMBER' };
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'View details: Tax filing help' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('priya@tax.example.com');
    expect(within(dialog).queryByRole('button', { name: /feature/i })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Remove listing' })).not.toBeInTheDocument();
  });
});
