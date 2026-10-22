import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeComment, makePost, page } from '@/components/social/__tests__/fixtures';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'p1' }), useRouter: () => ({ push, back: vi.fn() }) }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'me', fullName: 'Me', role: 'MEMBER' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const socialApi = vi.hoisted(() => ({ getPost: vi.fn(), comments: vi.fn(), trending: vi.fn(), mentionSearch: vi.fn() }));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import PostPage from '@/app/(main)/posts/[id]/page';
import { commentIdFromHash } from '@/lib/social';

beforeEach(() => {
  socialApi.getPost.mockReset();
  socialApi.comments.mockReset().mockResolvedValue(page([makeComment({ id: 'c42', content: 'Deep linked comment' })]));
  socialApi.trending.mockReset().mockResolvedValue([]);
  socialApi.mentionSearch.mockReset().mockResolvedValue([]);
  window.location.hash = '';
});

describe('commentIdFromHash', () => {
  it('parses #comment-<id> only', () => {
    expect(commentIdFromHash('#comment-c42')).toBe('c42');
    expect(commentIdFromHash('#comment-')).toBeNull();
    expect(commentIdFromHash('#other')).toBeNull();
    expect(commentIdFromHash(null)).toBeNull();
  });
});

describe('Post page', () => {
  it('shows the post with its comments open and highlights a deep-linked comment', async () => {
    window.location.hash = '#comment-c42';
    socialApi.getPost.mockResolvedValue(makePost({ content: 'The shared post' }));
    render(<PostPage />);
    expect(await screen.findByText('The shared post')).toBeInTheDocument();
    const comment = await screen.findByText('Deep linked comment');
    expect(comment.closest('#comment-c42')).toHaveClass('ring-2');
  });

  it('shows a friendly not-available state on 404', async () => {
    socialApi.getPost.mockRejectedValue({ response: { status: 404, data: { error: { code: 'NOT_FOUND' } } } });
    render(<PostPage />);
    expect(await screen.findByText('This post isn’t available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your feed' })).toHaveAttribute('href', '/dashboard');
  });

  it('offers a retry on other errors', async () => {
    socialApi.getPost.mockRejectedValue({ response: { status: 500, data: { error: { message: 'Server exploded' } } } });
    render(<PostPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
