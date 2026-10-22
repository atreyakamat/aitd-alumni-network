import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PostComment } from '@/types';

const postApiMock = vi.hoisted(() => ({
  getPost: vi.fn(),
  addComment: vi.fn(),
  updateComment: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, postApi: postApiMock };
});

import { CommentItem, isCommentEdited, COMMENT_MAX_LENGTH } from '@/components/posts/CommentItem';
import { PostComments } from '@/components/posts/PostComments';

const AUTHOR = 'user-author';
const CREATED = '2026-10-01T10:00:00.000Z';

const makeComment = (overrides: Partial<PostComment> = {}): PostComment => ({
  id: 'c1',
  postId: 'p1',
  userId: AUTHOR,
  user: { id: AUTHOR, fullName: 'Ada Author', profilePhotoUrl: null },
  content: 'original words',
  parentId: null,
  createdAt: CREATED,
  updatedAt: CREATED,
  ...overrides,
});

const apiError = (message: string, status = 403) =>
  Object.assign(new Error('Request failed'), {
    response: { status, data: { success: false, error: { message, code: 'FORBIDDEN' } } },
  });

beforeEach(() => {
  postApiMock.getPost.mockReset();
  postApiMock.addComment.mockReset();
  postApiMock.updateComment.mockReset();
});

describe('isCommentEdited', () => {
  it('is false when updatedAt is missing or within a few seconds of createdAt', () => {
    expect(isCommentEdited({ createdAt: CREATED })).toBe(false);
    expect(isCommentEdited({ createdAt: CREATED, updatedAt: CREATED })).toBe(false);
    expect(isCommentEdited({ createdAt: CREATED, updatedAt: '2026-10-01T10:00:03.000Z' })).toBe(false);
  });

  it('is true when updatedAt is meaningfully later than createdAt', () => {
    expect(isCommentEdited({ createdAt: CREATED, updatedAt: '2026-10-01T10:05:00.000Z' })).toBe(true);
  });

  it('ignores unparseable dates', () => {
    expect(isCommentEdited({ createdAt: 'nope', updatedAt: 'also-nope' })).toBe(false);
  });
});

describe('<CommentItem>', () => {
  it('does not offer Edit to anyone but the author', () => {
    render(<CommentItem comment={makeComment()} currentUserId="someone-else" onUpdated={vi.fn()} />);
    expect(screen.getByText('original words')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('does not offer Edit when signed out', () => {
    render(<CommentItem comment={makeComment()} onUpdated={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('lets the author edit inline and saves trimmed content through the API', async () => {
    const onUpdated = vi.fn();
    const updated = makeComment({ content: 'better words', updatedAt: '2026-10-01T11:00:00.000Z' });
    postApiMock.updateComment.mockResolvedValue({ data: { success: true, data: updated } });

    render(<CommentItem comment={makeComment()} currentUserId={AUTHOR} onUpdated={onUpdated} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));

    const box = screen.getByRole('textbox', { name: /edit comment/i });
    expect(box).toHaveValue('original words');
    await userEvent.clear(box);
    await userEvent.type(box, '  better words  ');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(postApiMock.updateComment).toHaveBeenCalledWith('c1', 'better words');
    expect(onUpdated.mock.calls[0][0]).toMatchObject({ id: 'c1', content: 'better words' });
    expect(screen.queryByRole('textbox', { name: /edit comment/i })).not.toBeInTheDocument();
  });

  it('keeps existing replies when merging the server response', async () => {
    const onUpdated = vi.fn();
    const reply = makeComment({ id: 'r1', parentId: 'c1', content: 'a reply' });
    postApiMock.updateComment.mockResolvedValue({ data: { data: makeComment({ content: 'changed' }) } });

    render(<CommentItem comment={makeComment({ replies: [reply] })} currentUserId={AUTHOR} onUpdated={onUpdated} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const box = screen.getByRole('textbox', { name: /edit comment/i });
    await userEvent.clear(box);
    await userEvent.type(box, 'changed');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(onUpdated.mock.calls[0][0].replies).toEqual([reply]);
  });

  it('Cancel discards the draft without calling the API', async () => {
    render(<CommentItem comment={makeComment()} currentUserId={AUTHOR} onUpdated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /edit comment/i }), ' extra');
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('original words')).toBeInTheDocument();
    expect(postApiMock.updateComment).not.toHaveBeenCalled();

    // Re-opening starts from the saved content, not the discarded draft.
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(screen.getByRole('textbox', { name: /edit comment/i })).toHaveValue('original words');
  });

  it('disables Save for blank, unchanged or oversized content', async () => {
    render(<CommentItem comment={makeComment()} currentUserId={AUTHOR} onUpdated={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    const box = screen.getByRole('textbox', { name: /edit comment/i });
    const save = () => screen.getByRole('button', { name: /save/i });

    expect(save()).toBeDisabled(); // unchanged
    await userEvent.clear(box);
    await userEvent.type(box, '   ');
    expect(save()).toBeDisabled(); // blank

    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste('a'.repeat(COMMENT_MAX_LENGTH + 1));
    expect(save()).toBeDisabled(); // too long
  });

  it('shows the API error and stays in edit mode when saving fails', async () => {
    const onUpdated = vi.fn();
    postApiMock.updateComment.mockRejectedValue(apiError('Not authorized to edit this comment'));

    render(<CommentItem comment={makeComment()} currentUserId={AUTHOR} onUpdated={onUpdated} />);
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /edit comment/i }), '!');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Not authorized to edit this comment');
    expect(screen.getByRole('textbox', { name: /edit comment/i })).toHaveValue('original words!');
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('marks edited comments', () => {
    const { rerender } = render(<CommentItem comment={makeComment()} onUpdated={vi.fn()} />);
    expect(screen.queryByText(/\(edited\)/i)).not.toBeInTheDocument();

    rerender(<CommentItem comment={makeComment({ updatedAt: '2026-10-02T09:00:00.000Z' })} onUpdated={vi.fn()} />);
    expect(screen.getByText(/\(edited\)/i)).toBeInTheDocument();
  });
});

describe('<PostComments>', () => {
  const reply = makeComment({ id: 'r1', parentId: 'c1', content: 'my reply' });
  const theirs = makeComment({
    id: 'c2',
    userId: 'other',
    user: { id: 'other', fullName: 'Other Person' },
    content: 'their comment',
    replies: [reply],
  });

  it('loads comments and updates the list in place after an edit (including replies)', async () => {
    postApiMock.getPost.mockResolvedValue({ data: { data: { id: 'p1', comments: [theirs] } } });
    postApiMock.updateComment.mockResolvedValue({
      data: { data: makeComment({ id: 'r1', parentId: 'c1', content: 'reply, revised', updatedAt: '2026-10-03T00:00:00.000Z' }) },
    });

    render(<PostComments postId="p1" currentUserId={AUTHOR} />);

    expect(await screen.findByText('their comment')).toBeInTheDocument();
    expect(postApiMock.getPost).toHaveBeenCalledWith('p1');

    // Only the author's own reply is editable.
    const editButtons = screen.getAllByRole('button', { name: /edit/i });
    expect(editButtons).toHaveLength(1);

    await userEvent.click(editButtons[0]);
    const box = screen.getByRole('textbox', { name: /edit comment/i });
    await userEvent.clear(box);
    await userEvent.type(box, 'reply, revised');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    const replyItem = (await screen.findByText('reply, revised')).closest('[data-comment-id]') as HTMLElement;
    expect(replyItem).toHaveAttribute('data-comment-id', 'r1');
    expect(within(replyItem).getByText(/\(edited\)/i)).toBeInTheDocument();
    expect(screen.queryByText('my reply')).not.toBeInTheDocument();
    expect(screen.getByText('their comment')).toBeInTheDocument();
  });

  it('shows a load error', async () => {
    postApiMock.getPost.mockRejectedValue(apiError('Post not found', 404));
    render(<PostComments postId="p1" currentUserId={AUTHOR} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Post not found');
  });

  it('adds a new comment to the top of the list', async () => {
    const onCommentAdded = vi.fn();
    postApiMock.getPost.mockResolvedValue({ data: { data: { id: 'p1', comments: [theirs] } } });
    postApiMock.addComment.mockResolvedValue({ data: { data: makeComment({ id: 'c3', content: 'fresh thought' }) } });

    render(<PostComments postId="p1" currentUserId={AUTHOR} onCommentAdded={onCommentAdded} />);
    await screen.findByText('their comment');

    await userEvent.type(screen.getByRole('textbox', { name: /write a comment/i }), '  fresh thought ');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));

    expect(await screen.findByText('fresh thought')).toBeInTheDocument();
    expect(postApiMock.addComment).toHaveBeenCalledWith('p1', 'fresh thought');
    expect(onCommentAdded).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: /write a comment/i })).toHaveValue('');
  });
});
