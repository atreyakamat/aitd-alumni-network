import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ME, makeComment, makePost, page } from './fixtures';

const authState = vi.hoisted(() => ({ user: null as any }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const socialApi = vi.hoisted(() => ({
  comments: vi.fn(),
  replies: vi.fn(),
  addComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  reactComment: vi.fn(),
  reportComment: vi.fn(),
  mentionSearch: vi.fn(),
}));
vi.mock('@/lib/social', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/social')>()),
  socialApi,
}));

import { CommentThread, replyParentId } from '@/components/social/CommentThread';

const post = makePost();
const reply = (id: string, extra: Record<string, unknown> = {}) =>
  makeComment({ id, parentId: 'c1', content: `reply ${id}`, user: { id: `u-${id}`, fullName: `Replier ${id}` }, ...extra });

beforeEach(() => {
  authState.user = { ...ME };
  toast.mockReset();
  Object.values(socialApi).forEach((fn) => fn.mockReset());
  socialApi.mentionSearch.mockResolvedValue([]);
});

describe('replyParentId', () => {
  it('flattens replies to one level', () => {
    expect(replyParentId({ id: 'c1', parentId: null })).toBe('c1');
    expect(replyParentId({ id: 'r1', parentId: 'c1' })).toBe('c1');
  });
});

describe('CommentThread', () => {
  it('shows preview replies and loads the rest on demand', async () => {
    socialApi.comments.mockResolvedValue(page([makeComment({ replyCount: 3, previewReplies: [reply('r1')] })]));
    socialApi.replies.mockResolvedValue(page([reply('r1'), reply('r2'), reply('r3')]));
    const onCountChange = vi.fn();
    render(<CommentThread post={post} onCountChange={onCountChange} />);

    expect(await screen.findByText('Great news')).toBeInTheDocument();
    expect(screen.getByText('reply r1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View 2 more replies' }));
    await waitFor(() => expect(socialApi.replies).toHaveBeenCalledWith('c1', null));
    expect(await screen.findByText('reply r3')).toBeInTheDocument();
    // r1 was already shown as a preview: not duplicated
    expect(screen.getAllByText('reply r1')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /more replies/ })).not.toBeInTheDocument();
  });

  it('replying to a reply attaches to the top-level comment and pre-fills the mention', async () => {
    socialApi.comments.mockResolvedValue(page([makeComment({ replyCount: 1, previewReplies: [reply('r1')] })]));
    socialApi.addComment.mockImplementation(async (_postId: string, input: any) =>
      makeComment({ id: 'r9', parentId: input.parentId, content: input.content, user: { id: ME.id, fullName: ME.fullName }, viewer: { isAuthor: true } })
    );
    const onCountChange = vi.fn();
    render(<CommentThread post={post} onCountChange={onCountChange} />);
    await screen.findByText('reply r1');

    await userEvent.click(screen.getByRole('button', { name: 'Reply to Replier r1' }));
    const box = await screen.findByRole('combobox', { name: 'Write a reply' });
    expect(box).toHaveValue('@Replier r1 ');
    await userEvent.type(box, 'thanks!');
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }));

    await waitFor(() =>
      expect(socialApi.addComment).toHaveBeenCalledWith('p1', { content: '@Replier r1 thanks!', parentId: 'c1', mentionIds: ['u-r1'] })
    );
    expect(await screen.findByText(/thanks!/)).toBeInTheDocument();
    expect(onCountChange).toHaveBeenCalledWith(1);
  });

  it('posts a new top-level comment at the top', async () => {
    socialApi.comments.mockResolvedValue(page([makeComment()]));
    socialApi.addComment.mockResolvedValue(makeComment({ id: 'c2', content: 'Fresh take', user: { id: ME.id, fullName: ME.fullName } }));
    render(<CommentThread post={post} />);
    await screen.findByText('Great news');
    await userEvent.type(screen.getByRole('combobox', { name: 'Write a comment' }), 'Fresh take');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));
    const items = await screen.findAllByText(/Fresh take|Great news/);
    expect(items[0]).toHaveTextContent('Fresh take');
  });

  it('loads more comments with the cursor and switches sort order', async () => {
    socialApi.comments
      .mockResolvedValueOnce(page([makeComment()], 'next-1'))
      .mockResolvedValueOnce(page([makeComment({ id: 'c2', content: 'Second page' })]))
      .mockResolvedValueOnce(page([makeComment({ id: 'c3', content: 'Newest first' })]));
    render(<CommentThread post={post} />);
    await screen.findByText('Great news');
    await userEvent.click(screen.getByRole('button', { name: 'Load more comments' }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(socialApi.comments).toHaveBeenLastCalledWith('p1', { sort: 'top', cursor: 'next-1' }, expect.anything());

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort comments' }), 'newest');
    expect(await screen.findByText('Newest first')).toBeInTheDocument();
    expect(socialApi.comments).toHaveBeenLastCalledWith('p1', { sort: 'newest', cursor: null }, expect.anything());
  });

  it('lets the post author delete someone else’s comment (but not edit it)', async () => {
    authState.user = { id: post.user.id, fullName: post.user.fullName, role: 'MEMBER' };
    socialApi.comments.mockResolvedValue(page([makeComment({ replyCount: 2 })]));
    socialApi.deleteComment.mockResolvedValue({});
    const onCountChange = vi.fn();
    render(<CommentThread post={post} onCountChange={onCountChange} />);
    await screen.findByText('Great news');
    await userEvent.click(screen.getByRole('button', { name: 'Comment options' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(socialApi.deleteComment).toHaveBeenCalledWith('c1'));
    expect(onCountChange).toHaveBeenCalledWith(-3);
    expect(screen.queryByText('Great news')).not.toBeInTheDocument();
  });

  it('reacts to a comment optimistically', async () => {
    socialApi.comments.mockResolvedValue(page([makeComment({ likeCount: 1 })]));
    socialApi.reactComment.mockResolvedValue({ reaction: 'LIKE', likeCount: 2 });
    render(<CommentThread post={post} />);
    await screen.findByText('Great news');
    await userEvent.click(screen.getByRole('button', { name: 'Like this comment' }));
    expect(socialApi.reactComment).toHaveBeenCalledWith('c1', 'LIKE');
    expect(await screen.findByLabelText('2 reactions')).toBeInTheDocument();
  });

  it('shows an error with retry when comments fail to load', async () => {
    socialApi.comments.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page([makeComment()]));
    render(<CommentThread post={post} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Great news')).toBeInTheDocument();
  });

  it('hides the composer for anonymous visitors', async () => {
    authState.user = null;
    socialApi.comments.mockResolvedValue(page([]));
    render(<CommentThread post={post} />);
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Write a comment' })).not.toBeInTheDocument();
  });
});
