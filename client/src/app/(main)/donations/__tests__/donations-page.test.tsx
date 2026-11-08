import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const authState = {
  user: { id: 'donor-1', fullName: 'Current Donor', email: 'donor@example.com' } as any,
  isLoading: false,
};
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const donationApi = vi.hoisted(() => ({
  getDonorsWall: vi.fn(),
  getLeaderboard: vi.fn(),
  getChapterDonations: vi.fn(),
  getStats: vi.fn(),
  createOrder: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  donationApi,
}));

import DonationsPage from '@/app/(main)/donations/page';

describe('DonationsPage (/donations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    donationApi.getDonorsWall.mockResolvedValue({
      data: {
        data: [
          {
            id: 'don-1',
            amount: 5000,
            isAnonymous: false,
            dedicatedTo: 'Prof. Sharma',
            message: 'In gratitude for our wonderful engineering mentors',
            createdAt: '2026-10-15T10:00:00.000Z',
            user: {
              id: 'u-1',
              fullName: 'Sunil Gupta',
              profilePhotoUrl: null,
              batchYear: 2015,
            },
            chapter: { id: 'ch-1', name: 'Delhi Chapter' },
          },
          {
            id: 'don-2',
            amount: 2500,
            isAnonymous: true,
            dedicatedTo: null,
            message: 'Keep up the great work!',
            createdAt: '2026-10-18T10:00:00.000Z',
            user: null,
            chapter: null,
          },
        ],
      },
    });

    donationApi.getLeaderboard.mockResolvedValue({
      data: {
        data: [
          {
            id: 'u-1',
            amount: 50000,
            user: {
              id: 'u-1',
              fullName: 'Sunil Gupta',
              profilePhotoUrl: null,
              batchYear: 2015,
            },
          },
        ],
      },
    });

    donationApi.getChapterDonations.mockResolvedValue({
      data: { data: [] },
    });

    donationApi.getStats.mockResolvedValue({
      data: {
        data: {
          totalAmount: 125000,
          totalDonors: 42,
          thisMonthAmount: 15000,
        },
      },
    });
  });

  it('renders wall of donors with contributors, message, and dedication', async () => {
    render(<DonationsPage />);

    expect(await screen.findByText('Sunil Gupta')).toBeInTheDocument();
    expect(screen.getByText('Anonymous Donor')).toBeInTheDocument();
    expect(
      screen.getByText('"In gratitude for our wonderful engineering mentors"')
    ).toBeInTheDocument();
    expect(screen.getByText('"In honor of Prof. Sharma"')).toBeInTheDocument();
    expect(screen.getByText('Delhi Chapter')).toBeInTheDocument();
  });

  it('filters donors using the search input', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);

    expect(await screen.findByText('Sunil Gupta')).toBeInTheDocument();
    expect(screen.getByText('Anonymous Donor')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search donors...');
    await user.type(searchInput, 'Sunil');

    expect(screen.getByText('Sunil Gupta')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Anonymous Donor')).not.toBeInTheDocument();
    });

    await user.clear(searchInput);
    await user.type(searchInput, 'gratitude');

    expect(screen.getByText('Sunil Gupta')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Anonymous Donor')).not.toBeInTheDocument();
    });

    await user.clear(searchInput);
    await user.type(searchInput, 'NonExistentDonorXYZ');

    expect(await screen.findByText('No matching donors found')).toBeInTheDocument();
  });

  it('renders the leaderboard tab with top contributors', async () => {
    const user = userEvent.setup();
    render(<DonationsPage />);

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Leaderboard/i })).toBeInTheDocument();
    });

    const leaderboardTab = screen.getByRole('tab', { name: /Leaderboard/i });
    await user.click(leaderboardTab);

    expect(await screen.findByText('Top Contributors')).toBeInTheDocument();
    expect(screen.getByText('Class of 2015')).toBeInTheDocument();
  });
});
