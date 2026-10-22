import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AUTHOR, ME, apiError, makePost, page, rawPost } from './fixtures';
import type { SocialPost } from '@/lib/social';

const authState = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const socialApi = vi.hoisted(() => ({
  react: vi.fn(),
  toggleSave: vi.fn(),
  repost: vi.fn(),
  undoRepost: vi.fn(),
  updatePost: vi.fn(),
  deletePost: vi.fn(),
  comments: vi.fn(),
  reactions: vi.fn(),
  reportPost: vi.fn(),
  follow: vi.fn(),
  mentionSearch: vi.fn(),
  view: vi.fn(),
}));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import { PostCard, updateTarget } from '@/components/social/PostCard';

function Harness({ initial, onRemove, onCreated }: { initial: SocialPost; onRemove?: (id: string) => void; onCreated?: (p: SocialPost) => void }) {
  const [post, setPost] = useState(initial);
  return <PostCard post={post} onChange={setPost} onRemove={onRemove} onCreated={onCreated} />;
}

beforeEach(() => {
  authState.user = { ...ME };
  toast.mockReset();
  Object.values(socialApi).forEach((fn) => fn.mockReset());
  socialApi.comments.mockResolvedValue(page([]));
  socialApi.reactions.mockResolvedValue(page([]));
});

describe('PostCard reactions', () => {
  it('likes optimistically, then shows the server totals', async () => {
    let resolve!: (v: unknown) => void;
    socialApi.react.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<Harness initial={makePost()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Like this post' }));
    // Optimistic: pressed and 3 reactions before the server answers
    expect(screen.getByRole('button', { name: /Remove Like reaction/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^3 reactions/ })).toBeInTheDocument();
    expect(socialApi.react).toHaveBeenCalledWith('p1', 'LIKE');

    resolve({ reaction: 'LIKE', counts: { reactions: 10 }, reactionSummary: { LIKE: 10 } });
    expect(await screen.findByRole('button', { name: /^10 reactions/ })).toBeInTheDocument();
  });

  it('picks another reaction from the picker', async () => {
    socialApi.react.mockResolvedValue({ reaction: 'CELEBRATE', counts: { reactions: 3 }, reactionSummary: { LIKE: 2, CELEBRATE: 1 } });
    render(<Harness initial={makePost()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose a reaction' }));
    const toolbar = screen.getByRole('toolbar', { name: 'Reactions' });
    expect(within(toolbar).getAllByRole('button')).toHaveLength(6);
    await userEvent.click(within(toolbar).getByRole('button', { name: 'Celebrate' }));
    expect(socialApi.react).toHaveBeenCalledWith('p1', 'CELEBRATE');
    expect(await screen.findByRole('button', { name: /Remove Celebrate reaction/ })).toBeInTheDocument();
  });

  it('rolls back and tells the user when the reaction fails', async () => {
    socialApi.react.mockRejectedValue(apiError('SERVER_ERROR', 500, 'Boom'));
    render(<Harness initial={makePost()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Like this post' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Could not save your reaction' })));
    expect(screen.getByRole('button', { name: 'Like this post' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^2 reactions/ })).toBeInTheDocument();
  });

  it('closes the picker with Escape and moves focus with the arrow keys', async () => {
    render(<Harness initial={makePost()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose a reaction' }));
    expect(screen.getByRole('button', { name: 'Like' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Celebrate' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('button', { name: 'Funny' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  });
});

describe('PostCard reposts and saves', () => {
  it('reposts and hands the new repost to the feed', async () => {
    const created = makePost({ id: 'r1', isRepost: true, content: '', user: ME, repostOf: rawPost() });
    socialApi.repost.mockResolvedValue(created);
    const onCreated = vi.fn();
    render(<Harness initial={makePost()} onCreated={onCreated} />);
    await userEvent.click(screen.getByRole('button', { name: 'Repost options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Repost' }));
    await waitFor(() => expect(socialApi.repost).toHaveBeenCalledWith('p1'));
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(await screen.findByRole('button', { name: /Reposted. Repost options/ })).toBeInTheDocument();
    expect(screen.getByText('1 repost')).toBeInTheDocument();
  });

  it('quotes a post with the viewer’s thoughts', async () => {
    socialApi.repost.mockResolvedValue(makePost({ id: 'q1', isRepost: true, content: 'Proud!', repostOf: rawPost() }));
    const onCreated = vi.fn();
    render(<Harness initial={makePost()} onCreated={onCreated} />);
    await userEvent.click(screen.getByRole('button', { name: 'Repost options' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Quote with your thoughts' }));
    await userEvent.type(await screen.findByRole('combobox', { name: 'Your thoughts' }), 'Proud!');
    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => expect(socialApi.repost).toHaveBeenCalledWith('p1', { content: 'Proud!' }));
    expect(onCreated).toHaveBeenCalled();
  });

  it('does not allow reposting connection-only posts', async () => {
    render(<Harness initial={makePost({ visibility: 'CONNECTIONS' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Repost options' }));
    expect(await screen.findByRole('menuitem', { name: 'Repost' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Only public posts can be reposted.')).toBeInTheDocument();
  });

  it('saves and unsaves', async () => {
    socialApi.toggleSave.mockResolvedValueOnce({ saved: true }).mockResolvedValueOnce({ saved: false });
    render(<Harness initial={makePost()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Save post' }));
    expect(await screen.findByRole('button', { name: 'Unsave post' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Unsave post' }));
    expect(await screen.findByRole('button', { name: 'Save post' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders a plain repost as the original with a "reposted" header and acts on the original', async () => {
    socialApi.react.mockResolvedValue({ reaction: 'LIKE', counts: { reactions: 3 } });
    const plain = makePost({ id: 'r1', isRepost: true, content: '', user: { id: 'u-friend', fullName: 'Friend Person' }, repostOf: rawPost({ id: 'orig' }) });
    render(<Harness initial={plain} />);
    expect(screen.getByText('reposted this')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Friend Person' })).toBeInTheDocument();
    expect(screen.getAllByText(/Hello/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Like this post' }));
    expect(socialApi.react).toHaveBeenCalledWith('orig', 'LIKE');
  });

  it('shows an unavailable original inside a quote post', () => {
    render(<Harness initial={makePost({ id: 'q', isRepost: true, content: 'Look at this', repostOf: { id: 'gone', unavailable: true } })} />);
    expect(screen.getByText('This post is no longer available.')).toBeInTheDocument();
  });
});

describe('PostCard menu permissions', () => {
  const openMenu = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Post options' }));
    return screen.findByRole('menu');
  };

  it('lets the author edit and delete (with an in-app confirmation), but not report', async () => {
    socialApi.deletePost.mockResolvedValue({});
    const onRemove = vi.fn();
    render(<Harness initial={makePost({ user: ME, viewer: { isAuthor: true } })} onRemove={onRemove} />);
    const menu = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Report' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Pin/ })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this post?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('p1'));
  });

  it('lets other members report but not edit or delete', async () => {
    render(<Harness initial={makePost()} />);
    const menu = await openMenu();
    expect(within(menu).getByRole('menuitem', { name: 'Report' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('gives admins pin and delete, but never edit of someone else’s words', async () => {
    authState.user = { ...ME, role: 'ADMIN', userRole: 'ADMIN' };
    socialApi.updatePost.mockResolvedValue(makePost({ isPinned: true }));
    render(<Harness initial={makePost()} />);
    const menu = await openMenu();
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Pin to top' }));
    await waitFor(() => expect(socialApi.updatePost).toHaveBeenCalledWith('p1', { isPinned: true }));
    expect(await screen.findByText('Pinned')).toBeInTheDocument();
  });

  it('edits inline and marks the post as edited', async () => {
    socialApi.updatePost.mockResolvedValue(makePost({ content: 'Edited words', user: ME, editedAt: '2026-10-19T11:00:00.000Z' }));
    render(<Harness initial={makePost({ user: ME, viewer: { isAuthor: true } })} />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    const box = await screen.findByRole('combobox', { name: 'Edit post' });
    await userEvent.clear(box);
    await userEvent.type(box, 'Edited words');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(socialApi.updatePost).toHaveBeenCalledWith('p1', { content: 'Edited words', mentionIds: [] }));
    expect(await screen.findByText('Edited words')).toBeInTheDocument();
    expect(screen.getByText('· Edited')).toBeInTheDocument();
  });

  it('offers a Follow button for authors the viewer does not follow', () => {
    render(<Harness initial={makePost({ viewer: { followsAuthor: false } })} />);
    expect(screen.getByRole('button', { name: `Follow ${AUTHOR.fullName}` })).toBeInTheDocument();
  });

  it('shows a sign-in prompt instead of actions for anonymous visitors', () => {
    authState.user = null;
    render(<Harness initial={makePost()} />);
    expect(screen.getByRole('link', { name: 'Sign in to react' })).toHaveAttribute('href', '/login?next=%2Fposts%2Fp1');
    expect(screen.queryByRole('button', { name: 'Save post' })).not.toBeInTheDocument();
  });
});

describe('updateTarget', () => {
  it('updates the original for plain reposts and the post itself otherwise', () => {
    const plain = makePost({ id: 'r', isRepost: true, content: '', repostOf: rawPost({ id: 'o' }) });
    const updated = updateTarget(plain, (p) => ({ ...p, content: 'changed' }));
    expect((updated.repostOf as SocialPost).content).toBe('changed');
    expect(updated.content).toBe('');
    expect(updateTarget(makePost(), (p) => ({ ...p, content: 'x' })).content).toBe('x');
  });
});
