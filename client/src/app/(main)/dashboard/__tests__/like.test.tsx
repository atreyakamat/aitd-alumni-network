import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makePost, page } from '@/components/social/__tests__/fixtures';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/context/auth-context', () => ({
  useAuth: () => ({ user: { id: 'me', fullName: 'Me', department: 'CS', batchYear: 2015, profileCompleteness: 40, role: 'MEMBER' } }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const networkApi = vi.hoisted(() => ({ getSuggestions: vi.fn() }));
const eventApi = vi.hoisted(() => ({ getUpcoming: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  networkApi,
  eventApi,
}));
const socialApi = vi.hoisted(() => ({ feed: vi.fn(), react: vi.fn(), trending: vi.fn(), createPost: vi.fn(), mentionSearch: vi.fn() }));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import DashboardPage from '@/app/(main)/dashboard/page';

const ok = (data: unknown) => Promise.resolve({ data });

beforeEach(() => {
  window.localStorage.clear();
  socialApi.feed.mockReset().mockResolvedValue(page([makePost({ id: 'p1', content: 'Hello alumni' })]));
  socialApi.react.mockReset();
  socialApi.trending.mockReset().mockResolvedValue([{ tag: 'reunion2026', postCount: 12 }]);
  socialApi.createPost.mockReset();
  socialApi.mentionSearch.mockReset().mockResolvedValue([]);
  networkApi.getSuggestions.mockReset().mockImplementation(() => ok({ success: true, data: [{ id: 'u7', fullName: 'Suggested Person', batchYear: 2014 }] }));
  eventApi.getUpcoming.mockReset().mockImplementation(() => ok({ success: true, data: [{ id: 'e1', title: 'Homecoming', startDate: '2026-12-01T10:00:00.000Z', city: 'Pune' }] }));
});

describe('Dashboard (home feed)', () => {
  it('renders composer, ranked feed, trending tags, who-to-follow and events', async () => {
    render(<DashboardPage />);
    expect(screen.getByRole('combobox', { name: 'Write a post' })).toBeInTheDocument();
    expect(await screen.findByText('Hello alumni')).toBeInTheDocument();
    expect(socialApi.feed).toHaveBeenCalledWith('for-you', null, expect.anything());
    expect(await screen.findByRole('link', { name: /reunion2026/ })).toHaveAttribute('href', '/hashtags/reunion2026');
    expect(await screen.findByRole('button', { name: 'Follow Suggested Person' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Homecoming/ })).toHaveAttribute('href', '/events/e1');
  });

  it('reacts to a feed post and shows the server count', async () => {
    socialApi.react.mockResolvedValue({ reaction: 'LIKE', counts: { reactions: 3 }, reactionSummary: { LIKE: 3 } });
    render(<DashboardPage />);
    await screen.findByText('Hello alumni');
    await userEvent.click(screen.getByRole('button', { name: 'Like this post' }));
    await waitFor(() => expect(socialApi.react).toHaveBeenCalledWith('p1', 'LIKE'));
    expect(await screen.findByRole('button', { name: /^3 reactions/ })).toBeInTheDocument();
  });

  it('puts a new post at the top of the feed', async () => {
    socialApi.createPost.mockResolvedValue(makePost({ id: 'mine', content: 'My fresh update', user: { id: 'me', fullName: 'Me' } }));
    render(<DashboardPage />);
    await screen.findByText('Hello alumni');
    await userEvent.type(screen.getByRole('combobox', { name: 'Write a post' }), 'My fresh update');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      const items = screen.getAllByText(/My fresh update|Hello alumni/);
      expect(items[0]).toHaveTextContent('My fresh update');
    });
  });
});
