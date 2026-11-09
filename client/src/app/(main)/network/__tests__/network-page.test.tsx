import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const authState = {
  user: { id: 'current-user-1', fullName: 'Current User' } as any,
  isLoading: false,
};
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
}));

const networkApi = vi.hoisted(() => ({
  getConnections: vi.fn(),
  getPendingRequests: vi.fn(),
  getSuggestions: vi.fn(),
  respondToRequest: vi.fn(),
  sendRequest: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  networkApi,
}));

import NetworkPage from '@/app/(main)/network/page';

describe('NetworkPage (/network)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders connections tab without crashing on flattened partner objects', async () => {
    networkApi.getConnections.mockResolvedValueOnce({
      data: {
        data: [
          {
            connectionId: 'conn-1',
            id: 'partner-1',
            fullName: 'Jane Doe',
            profilePhotoUrl: null,
            headline: 'Senior Engineer',
            currentCompany: 'Acme Corp',
            batchYear: 2020,
            department: 'Computer Science',
          },
        ],
      },
    });
    networkApi.getPendingRequests.mockResolvedValueOnce({
      data: { data: { received: [], sent: [] } },
    });
    networkApi.getSuggestions.mockResolvedValueOnce({
      data: { data: [] },
    });

    render(<NetworkPage />);

    expect(screen.getByText('Loading your network...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });

    expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
    expect(screen.getByText(/Computer Science • Class of 2020/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Message/i })).toBeInTheDocument();
  });

  it('renders pending requests and allows accepting and declining them', async () => {
    const user = userEvent.setup();
    networkApi.getConnections.mockResolvedValue({
      data: { data: [] },
    });
    networkApi.getPendingRequests.mockResolvedValue({
      data: {
        data: {
          received: [
            {
              connectionId: 'req-1',
              user: {
                id: 'requester-1',
                fullName: 'Alice Smith',
                profilePhotoUrl: null,
                batchYear: 2022,
                department: 'Mechanical',
              },
              createdAt: '2026-10-20T10:00:00.000Z',
            },
          ],
          sent: [],
        },
      },
    });
    networkApi.getSuggestions.mockResolvedValue({
      data: { data: [] },
    });
    networkApi.respondToRequest.mockResolvedValue({ data: { success: true } });

    render(<NetworkPage />);

    await waitFor(() => {
      expect(screen.getByText('Requests')).toBeInTheDocument();
    });

    // Click Requests tab
    const requestsTab = screen.getByRole('tab', { name: /Requests/i });
    await user.click(requestsTab);

    expect(await screen.findByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText(/Alumnus • Class of 2022/)).toBeInTheDocument();

    // Accept request
    const acceptBtn = screen.getByRole('button', { name: /Accept/i });
    await user.click(acceptBtn);

    expect(networkApi.respondToRequest).toHaveBeenCalledWith('req-1', true);
  });

  describe('pending requests are paged', () => {
    const request = (id: string, name: string) => ({
      connectionId: id,
      user: { id: `user-${id}`, fullName: name, profilePhotoUrl: null, batchYear: 2020, department: 'Civil' },
      createdAt: '2026-10-20T10:00:00.000Z',
    });
    const page = (received: unknown[], info: { total: number; page: number; hasNextPage: boolean }) => ({
      data: {
        data: { received, sent: [] },
        pagination: { received: { ...info, limit: 2, totalPages: 2, hasPrevPage: info.page > 1 } },
      },
    });

    it('asks for the first page of received requests only, shows the real total and loads the next page on demand', async () => {
      const user = userEvent.setup();
      networkApi.getConnections.mockResolvedValue({ data: { data: [] } });
      networkApi.getSuggestions.mockResolvedValue({ data: { data: [] } });
      networkApi.getPendingRequests
        .mockResolvedValueOnce(page([request('r1', 'Alice One'), request('r2', 'Bob Two')], { total: 3, page: 1, hasNextPage: true }))
        .mockResolvedValueOnce(page([request('r3', 'Carol Three')], { total: 3, page: 2, hasNextPage: false }));

      render(<NetworkPage />);

      await user.click(await screen.findByRole('tab', { name: /Requests/i }));
      expect(await screen.findByText('Alice One')).toBeInTheDocument();
      expect(screen.getByText('Bob Two')).toBeInTheDocument();
      expect(screen.queryByText('Carol Three')).not.toBeInTheDocument();
      // the badge counts what is waiting, not what is loaded so far
      expect(screen.getByRole('tab', { name: /Requests/i })).toHaveTextContent('3');
      expect(networkApi.getPendingRequests).toHaveBeenNthCalledWith(1, { type: 'received', page: 1, limit: 20 });

      await user.click(screen.getByRole('button', { name: /Load more/i }));

      expect(await screen.findByText('Carol Three')).toBeInTheDocument();
      expect(screen.getByText('Alice One')).toBeInTheDocument();
      expect(networkApi.getPendingRequests).toHaveBeenNthCalledWith(2, { type: 'received', page: 2, limit: 20 });
      expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument();
    });

    it('offers no "Load more" when everything fits on one page', async () => {
      const user = userEvent.setup();
      networkApi.getConnections.mockResolvedValue({ data: { data: [] } });
      networkApi.getSuggestions.mockResolvedValue({ data: { data: [] } });
      networkApi.getPendingRequests.mockResolvedValue(page([request('r1', 'Alice One')], { total: 1, page: 1, hasNextPage: false }));

      render(<NetworkPage />);

      await user.click(await screen.findByRole('tab', { name: /Requests/i }));
      expect(await screen.findByText('Alice One')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Load more/i })).not.toBeInTheDocument();
    });

    it('keeps what is already shown and says so when a further page fails to load', async () => {
      const user = userEvent.setup();
      networkApi.getConnections.mockResolvedValue({ data: { data: [] } });
      networkApi.getSuggestions.mockResolvedValue({ data: { data: [] } });
      networkApi.getPendingRequests
        .mockResolvedValueOnce(page([request('r1', 'Alice One')], { total: 2, page: 1, hasNextPage: true }))
        .mockRejectedValueOnce(new Error('offline'));

      render(<NetworkPage />);

      await user.click(await screen.findByRole('tab', { name: /Requests/i }));
      await user.click(await screen.findByRole('button', { name: /Load more/i }));

      await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
      expect(screen.getByText('Alice One')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Load more/i })).toBeInTheDocument();
    });
  });

  it('renders suggestions and allows sending connection requests', async () => {
    const user = userEvent.setup();
    networkApi.getConnections.mockResolvedValue({
      data: { data: [] },
    });
    networkApi.getPendingRequests.mockResolvedValue({
      data: { data: { received: [], sent: [] } },
    });
    networkApi.getSuggestions.mockResolvedValue({
      data: {
        data: [
          {
            id: 'suggested-1',
            fullName: 'Bob Marley',
            profilePhotoUrl: null,
            headline: 'Musician & Alum',
            batchYear: 2018,
            department: 'Civil',
          },
        ],
      },
    });
    networkApi.sendRequest.mockResolvedValue({ data: { success: true } });

    render(<NetworkPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Suggestions/i })).toBeInTheDocument();
    });

    const suggestionsTab = screen.getByRole('tab', { name: /Suggestions/i });
    await user.click(suggestionsTab);

    expect(await screen.findByText('Bob Marley')).toBeInTheDocument();

    const connectBtn = screen.getByRole('button', { name: /Connect/i });
    await user.click(connectBtn);

    expect(networkApi.sendRequest).toHaveBeenCalledWith('suggested-1');
  });
});
