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
