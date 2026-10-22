import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { normalizeReport } from '@/lib/social';
import { rawPost } from '@/components/social/__tests__/fixtures';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'ADMIN', userRole: 'ADMIN' } }) }));

const socialApi = vi.hoisted(() => ({ adminReports: vi.fn(), resolveReport: vi.fn() }));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import AdminReportsPage from '@/app/(main)/admin/reports/page';

const postReport = normalizeReport({
  id: 'rep1',
  reason: 'SPAM',
  details: 'Selling followers',
  status: 'OPEN',
  createdAt: '2026-10-19T09:00:00.000Z',
  reportCount: 3,
  reporter: { id: 'u9', fullName: 'Vigilant Member' },
  post: rawPost({ id: 'bad', content: 'Buy followers now' }),
});
const commentReport = normalizeReport({
  id: 'rep2',
  reason: 'HARASSMENT',
  status: 'OPEN',
  createdAt: '2026-10-19T09:00:00.000Z',
  reporter: { id: 'u8', fullName: 'Another Member' },
  comment: { id: 'c7', postId: 'p3', content: 'You are terrible', user: { id: 'u5', fullName: 'Rude Person' } },
});

beforeEach(() => {
  toast.mockReset();
  socialApi.adminReports.mockReset().mockImplementation(async (status: string) =>
    status === 'OPEN' ? { items: [postReport, commentReport], nextCursor: null } : { items: [], nextCursor: null }
  );
  socialApi.resolveReport.mockReset().mockResolvedValue({ status: 'RESOLVED' });
});

describe('Admin reported content', () => {
  it('lists grouped open reports with the reported item and its context link', async () => {
    render(<AdminReportsPage />);
    expect(await screen.findByText('Buy followers now')).toBeInTheDocument();
    expect(screen.getByText('3 reports')).toBeInTheDocument();
    expect(screen.getByText(/Selling followers/)).toBeInTheDocument();
    expect(screen.getByText('You are terrible')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View in context/ })).toHaveAttribute('href', '/posts/p3#comment-c7');
  });

  it('removes content with an audit note and drops the report from the list', async () => {
    render(<AdminReportsPage />);
    await screen.findByText('Buy followers now');
    const [first] = screen.getAllByRole('button', { name: 'Remove content' });
    await userEvent.click(first);
    const dialog = await screen.findByRole('dialog', { name: 'Remove this content?' });
    await userEvent.type(within(dialog).getByLabelText(/Note for the audit log/), 'Spam ring');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove content' }));
    await waitFor(() => expect(socialApi.resolveReport).toHaveBeenCalledWith('rep1', { action: 'REMOVE_CONTENT', note: 'Spam ring' }));
    await waitFor(() => expect(screen.queryByText('Buy followers now')).not.toBeInTheDocument());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Content removed' }));
  });

  it('dismisses a report without a note', async () => {
    render(<AdminReportsPage />);
    await screen.findByText('You are terrible');
    const dismiss = screen.getAllByRole('button', { name: 'Dismiss' });
    await userEvent.click(dismiss[1]);
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dismiss report' }));
    await waitFor(() => expect(socialApi.resolveReport).toHaveBeenCalledWith('rep2', { action: 'DISMISS' }));
  });

  it('switches to the resolved tab and shows its empty state', async () => {
    render(<AdminReportsPage />);
    await screen.findByText('Buy followers now');
    await userEvent.click(screen.getByRole('tab', { name: 'Dismissed' }));
    expect(await screen.findByText('No dismissed reports')).toBeInTheDocument();
    expect(socialApi.adminReports).toHaveBeenLastCalledWith('DISMISSED', null, expect.anything());
  });
});
