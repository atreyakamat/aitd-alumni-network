/**
 * Videos, Magazine, Requirements and Referrals through the REAL api client, answered with the exact shape the server sends
 * for a list ({ success, data: { data: [...], pagination } }). These pages once showed an empty list forever because the
 * client read `.items` while the server sends `.data`; no test ran the page against a server-shaped response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn(), defaults: { baseURL: 'http://localhost:5000/api' } },
}));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', userRole: 'MEMBER' }, isAuthenticated: true }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/videos/SubmitVideoDialog', () => ({ SubmitVideoDialog: () => null }));
vi.mock('@/components/referrals/RequestReferralDialog', () => ({ RequestReferralDialog: () => null }));

import VideosPage from '@/app/(main)/videos/page';
import MagazinePage from '@/app/(main)/magazine/page';
import RequirementsPage from '@/app/(main)/requirements/page';
import ReferralsPage from '@/app/(main)/referrals/page';

const list = (rows: unknown[]) => ({
  data: { success: true, data: { data: rows, pagination: { total: rows.length, page: 1, limit: 24, totalPages: 1 } } },
});
const serverError = () => Object.assign(new Error('Request failed'), { response: { status: 500, data: { success: false, error: { message: 'Server hiccup' } } } });

beforeEach(() => get.mockReset());

describe('Videos page', () => {
  it('shows the videos the server returns', async () => {
    get.mockResolvedValue(list([{ id: 'v1', title: 'Convocation 2026', status: 'APPROVED', viewCount: 12, videoUrl: '/uploads/college-videos/a.mp4', category: 'Campus', submittedBy: { id: 'a', fullName: 'Ada' } }]));
    render(<VideosPage />);
    expect(await screen.findByText('Convocation 2026')).toBeInTheDocument();
  });

  it('says so when there are none', async () => {
    get.mockResolvedValue(list([]));
    render(<VideosPage />);
    await waitFor(() => expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument());
    expect(screen.queryByText('Convocation 2026')).not.toBeInTheDocument();
  });

  it('shows the server problem and recovers on retry', async () => {
    get.mockRejectedValueOnce(serverError()).mockResolvedValue(list([{ id: 'v1', title: 'Back online', status: 'APPROVED', viewCount: 0, videoUrl: '/uploads/college-videos/a.mp4' }]));
    render(<VideosPage />);
    expect(await screen.findByText('Server hiccup')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Back online')).toBeInTheDocument();
  });
});

describe('Magazine page', () => {
  it('shows the editions the server returns', async () => {
    get.mockResolvedValue(list([{ id: 'm1', title: 'Agnelite Vol 12', edition: 'Winter 2026', fileUrl: '/uploads/magazines/m.pdf', isPublished: true }]));
    render(<MagazinePage />);
    expect(await screen.findByText('Agnelite Vol 12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /read/i })).toHaveAttribute('href', expect.stringContaining('/uploads/magazines/m.pdf'));
  });

  it('says so when no edition is published', async () => {
    get.mockResolvedValue(list([]));
    render(<MagazinePage />);
    expect(await screen.findByText(/no editions published yet/i)).toBeInTheDocument();
  });

  it('shows a failure and recovers on retry', async () => {
    get.mockRejectedValueOnce(serverError()).mockResolvedValue(list([{ id: 'm1', title: 'After retry', fileUrl: '/uploads/magazines/m.pdf' }]));
    render(<MagazinePage />);
    expect(await screen.findByText('Server hiccup')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('After retry')).toBeInTheDocument();
  });
});

describe('Requirements page', () => {
  it('shows the requirements the server returns', async () => {
    get.mockResolvedValue(list([{ id: 'r1', title: 'Lab laptops', description: 'Ten laptops for the CS lab', category: 'HARDWARE', status: 'OPEN' }]));
    render(<RequirementsPage />);
    expect(await screen.findByText('Lab laptops')).toBeInTheDocument();
  });

  it('shows a failure and recovers on retry', async () => {
    get.mockRejectedValueOnce(serverError()).mockResolvedValue(list([{ id: 'r1', title: 'After retry', description: 'd', category: 'OTHER', status: 'OPEN' }]));
    render(<RequirementsPage />);
    expect(await screen.findByText('Server hiccup')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('After retry')).toBeInTheDocument();
  });
});

describe('Referrals page', () => {
  it('shows the requests the server returns', async () => {
    get.mockResolvedValue(
      list([{ id: 'q1', company: 'Acme Corp', message: 'Please refer me', status: 'PENDING', requester: { id: 'p1', fullName: 'Priya Rao' } }])
    );
    render(<ReferralsPage />);
    expect(await screen.findByText(/Acme Corp/)).toBeInTheDocument();
    expect(screen.getByText('Priya Rao')).toBeInTheDocument();
  });

  it('says so when there are no requests', async () => {
    get.mockResolvedValue(list([]));
    render(<ReferralsPage />);
    expect(await screen.findByText(/no referral requests yet/i)).toBeInTheDocument();
  });
});
