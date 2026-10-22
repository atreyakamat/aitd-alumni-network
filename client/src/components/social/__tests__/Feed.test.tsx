import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ME, makePost, page } from './fixtures';

const authState = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const socialApi = vi.hoisted(() => ({ feed: vi.fn(), comments: vi.fn(), reactions: vi.fn() }));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import { Feed, type PostListHandle } from '@/components/social/Feed';

beforeEach(() => {
  authState.user = { ...ME };
  socialApi.feed.mockReset();
  window.localStorage.clear();
});

describe('Feed', () => {
  it('loads For you by default and switches tabs (remembering the choice)', async () => {
    socialApi.feed.mockImplementation(async (tab: string) => page([makePost({ id: `p-${tab}`, content: `post from ${tab}` })]));
    render(<Feed />);
    expect(await screen.findByText('post from for-you')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'For you' })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: 'Following' }));
    expect(await screen.findByText('post from following')).toBeInTheDocument();
    expect(socialApi.feed).toHaveBeenLastCalledWith('following', null, expect.objectContaining({ signal: expect.anything() }));
    expect(window.localStorage.getItem('feed.tab')).toBe('following');
  });

  it('supports arrow-key navigation between tabs', async () => {
    socialApi.feed.mockResolvedValue(page([]));
    render(<Feed />);
    screen.getByRole('tab', { name: 'For you' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Following' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Following' })).toHaveFocus();
  });

  it('loads the next page with the cursor and de-duplicates', async () => {
    socialApi.feed
      .mockResolvedValueOnce(page([makePost({ id: 'a', content: 'first A' })], 'c2'))
      .mockResolvedValueOnce(page([makePost({ id: 'a', content: 'first A' }), makePost({ id: 'b', content: 'second B' })]));
    render(<Feed />);
    await screen.findByText('first A');
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('second B')).toBeInTheDocument();
    expect(screen.getAllByText('first A')).toHaveLength(1);
    expect(socialApi.feed).toHaveBeenLastCalledWith('for-you', 'c2', expect.anything());
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows a tab-specific empty state', async () => {
    socialApi.feed.mockResolvedValue(page([]));
    render(<Feed emptyAction={<a href="/network">Find alumni</a>} />);
    expect(await screen.findByText('Your feed is quiet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find alumni' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Following' }));
    expect(await screen.findByText('Nothing from people you follow yet')).toBeInTheDocument();
  });

  it('shows an error with retry', async () => {
    socialApi.feed.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([makePost({ content: 'back online' })]));
    render(<Feed />);
    await userEvent.click(await screen.findByRole('button', { name: /Try again/ }));
    expect(await screen.findByText('back online')).toBeInTheDocument();
  });

  it('puts a newly created post at the top', async () => {
    socialApi.feed.mockResolvedValue(page([makePost({ id: 'old', content: 'older post' })]));
    const ref = createRef<PostListHandle>();
    render(<Feed ref={ref} />);
    await screen.findByText('older post');
    act(() => ref.current?.prepend(makePost({ id: 'new', content: 'brand new post' })));
    await waitFor(() => {
      const posts = screen.getAllByText(/older post|brand new post/);
      expect(posts[0]).toHaveTextContent('brand new post');
    });
  });
});
