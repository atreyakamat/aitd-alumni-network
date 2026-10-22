import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ME, apiError } from './fixtures';

const authState = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const socialApi = vi.hoisted(() => ({
  reportPost: vi.fn(),
  reportComment: vi.fn(),
  follow: vi.fn(),
  unfollow: vi.fn(),
  followers: vi.fn(),
  following: vi.fn(),
}));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import { ReportDialog } from '@/components/social/ReportDialog';
import { FollowButton } from '@/components/social/FollowButton';
import { ProfileFollowBar } from '@/components/social/ProfileSocial';
import { RichText } from '@/components/social/RichText';

beforeEach(() => {
  authState.user = { ...ME };
  toast.mockReset();
  Object.values(socialApi).forEach((fn) => fn.mockReset());
});

describe('ReportDialog', () => {
  it('requires a reason and sends the report with optional details', async () => {
    socialApi.reportPost.mockResolvedValue({ id: 'rep1', status: 'OPEN' });
    const onOpenChange = vi.fn();
    render(<ReportDialog open onOpenChange={onOpenChange} target={{ kind: 'post', id: 'p1' }} />);
    const submit = screen.getByRole('button', { name: 'Submit report' });
    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: 'Harassment or bullying' }));
    await userEvent.type(screen.getByLabelText(/Details/), 'Repeated insults');
    await userEvent.click(submit);
    await waitFor(() => expect(socialApi.reportPost).toHaveBeenCalledWith('p1', { reason: 'HARASSMENT', details: 'Repeated insults' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Thanks for letting us know' }));
  });

  it('treats ALREADY_REPORTED as success and shows other errors inline', async () => {
    socialApi.reportComment.mockRejectedValueOnce(apiError('ALREADY_REPORTED', 409)).mockRejectedValueOnce(apiError('X', 500, 'Server down'));
    const onOpenChange = vi.fn();
    const { rerender } = render(<ReportDialog open onOpenChange={onOpenChange} target={{ kind: 'comment', id: 'c1' }} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Spam or scam' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Already reported' }));

    onOpenChange.mockReset();
    rerender(<ReportDialog open onOpenChange={onOpenChange} target={{ kind: 'comment', id: 'c1' }} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Spam or scam' }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server down');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('FollowButton', () => {
  it('follows optimistically and reports the server count', async () => {
    socialApi.follow.mockResolvedValue({ following: true, followerCount: 8 });
    const onChange = vi.fn();
    render(<FollowButton userId="u2" name="Ravi" following={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Follow Ravi' }));
    expect(await screen.findByRole('button', { name: 'Unfollow Ravi' })).toHaveAttribute('aria-pressed', 'true');
    expect(onChange).toHaveBeenCalledWith(true, 8);
  });

  it('rolls back on failure', async () => {
    socialApi.unfollow.mockRejectedValue(apiError('X', 500, 'nope'));
    render(<FollowButton userId="u2" name="Ravi" following />);
    await userEvent.click(screen.getByRole('button', { name: 'Unfollow Ravi' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
    expect(screen.getByRole('button', { name: 'Unfollow Ravi' })).toBeInTheDocument();
  });

  it('can disappear once following (post header chips)', async () => {
    render(<FollowButton userId="u2" name="Ravi" following hideWhenFollowing />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ProfileFollowBar', () => {
  it('shows counts, updates the follower count after following, and lists followers', async () => {
    socialApi.follow.mockResolvedValue({ following: true, followerCount: 6 });
    socialApi.followers.mockResolvedValue({ items: [{ id: 'f1', fullName: 'Fan One', viewerFollows: false }], nextCursor: null });
    render(<ProfileFollowBar profile={{ followerCount: 5, followingCount: 2, postCount: 1, isFollowing: false, fullName: 'Ravi' }} userId="u2" canFollow />);
    expect(screen.getByRole('button', { name: /5 followers/ })).toBeInTheDocument();
    expect(screen.getByText('post')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Follow Ravi' }));
    expect(await screen.findByRole('button', { name: /6 followers/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /6 followers/ }));
    expect(await screen.findByText('Fan One')).toBeInTheDocument();
    expect(socialApi.followers).toHaveBeenCalledWith('u2', null, expect.anything());
    expect(screen.getByRole('button', { name: 'Follow Fan One' })).toBeInTheDocument();
  });

  it('hides Follow when not allowed (own profile)', () => {
    render(<ProfileFollowBar profile={{ followerCount: 0 }} userId="me" canFollow={false} />);
    expect(screen.queryByRole('button', { name: 'Follow this member' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Following 0/ })).toBeInTheDocument();
  });
});

describe('RichText', () => {
  it('links hashtags, mentions and urls without injecting HTML', () => {
    render(<RichText text={'Hi @Asha Rao see #Batch2015 https://aitd.edu <b>x</b>'} mentions={[{ id: 'u1', fullName: 'Asha Rao' }]} />);
    expect(screen.getByRole('link', { name: '@Asha Rao' })).toHaveAttribute('href', '/profile/u1');
    expect(screen.getByRole('link', { name: '#Batch2015' })).toHaveAttribute('href', '/hashtags/batch2015');
    const url = screen.getByRole('link', { name: 'https://aitd.edu' });
    expect(url).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(url).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/<b>x<\/b>/)).toBeInTheDocument();
  });
});
