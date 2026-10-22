import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ME, rawPost } from './fixtures';

const authState = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { api } from '@/lib/api';
import { resetViewedPosts } from '@/lib/social';
import { ReelsViewer, reelIndexForKey } from '@/components/social/ReelsViewer';

const reel = (id: string) => rawPost({ id, isReel: true, videoUrl: `/uploads/videos/${id}.mp4`, content: `caption ${id}` });

let getSpy: any;
let postSpy: any;

beforeEach(() => {
  authState.user = { ...ME };
  resetViewedPosts();
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
  getSpy = vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/reels') return { data: { success: true, data: { items: [reel('r1'), reel('r2'), reel('r3')], nextCursor: null } } } as any;
    throw new Error(`unexpected GET ${url}`);
  });
  postSpy = vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true, data: { views: 1 } } } as any);
});

afterEach(() => {
  getSpy.mockRestore();
  postSpy.mockRestore();
});

const viewCalls = () => (postSpy.mock.calls as unknown[][]).filter(([url]) => String(url).endsWith('/view')).map(([url]) => url);

describe('reelIndexForKey', () => {
  it('moves within bounds', () => {
    expect(reelIndexForKey('ArrowDown', 0, 3)).toBe(1);
    expect(reelIndexForKey('ArrowDown', 2, 3)).toBe(2);
    expect(reelIndexForKey('ArrowUp', 0, 3)).toBe(0);
    expect(reelIndexForKey('k', 2, 3)).toBe(1);
    expect(reelIndexForKey('Enter', 1, 3)).toBeNull();
    expect(reelIndexForKey('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('ReelsViewer', () => {
  it('plays the first reel and records one view per reel, even when revisited', async () => {
    render(<ReelsViewer />);
    expect(await screen.findByText('caption r1')).toBeInTheDocument();
    await waitFor(() => expect(viewCalls()).toEqual(['/posts/r1/view']));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();

    const feed = screen.getByRole('feed');
    fireEvent.keyDown(feed, { key: 'ArrowDown' });
    await waitFor(() => expect(viewCalls()).toEqual(['/posts/r1/view', '/posts/r2/view']));
    fireEvent.keyDown(feed, { key: 'ArrowUp' });
    fireEvent.keyDown(feed, { key: 'ArrowDown' });
    // r1 and r2 were already counted this session
    await new Promise((r) => setTimeout(r, 20));
    expect(viewCalls()).toEqual(['/posts/r1/view', '/posts/r2/view']);
  });

  it('toggles mute for all reels', async () => {
    render(<ReelsViewer />);
    await screen.findByText('caption r1');
    const [unmute] = screen.getAllByRole('button', { name: 'Unmute' });
    await userEvent.click(unmute);
    expect(screen.getAllByRole('button', { name: 'Mute' })).toHaveLength(3);
  });

  it('shows an empty state with a create button', async () => {
    getSpy.mockImplementation(async () => ({ data: { success: true, data: { items: [], nextCursor: null } } }) as any);
    render(<ReelsViewer />);
    expect(await screen.findByText('No reels yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create the first reel' }));
    expect(await screen.findByRole('dialog', { name: 'Create a reel' })).toBeInTheDocument();
  });

  it('pulls a deep-linked reel that is not in the first page to the top', async () => {
    getSpy.mockImplementation(async (url: string) => {
      if (url === '/reels') return { data: { success: true, data: { items: [reel('r1')], nextCursor: null } } } as any;
      if (url === '/posts/deep') return { data: { success: true, data: reel('deep') } } as any;
      throw new Error(url);
    });
    render(<ReelsViewer startId="deep" />);
    expect(await screen.findByText('caption deep')).toBeInTheDocument();
    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveAttribute('aria-label', expect.stringContaining('Asha Rao'));
    expect(articles).toHaveLength(2);
  });
});
