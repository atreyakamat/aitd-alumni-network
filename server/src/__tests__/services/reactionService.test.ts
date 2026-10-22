jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { reactionService } from '../../services/reactionService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';
import { arrangeViewer, commentRow, OTHER, OWNER, postRow } from '../../../tests/helpers/social';

const createNotification = notificationService.createNotification as jest.Mock;
const dup = () => Object.assign(new Error('dup'), { code: 'P2002' });

beforeEach(() => {
  createNotification.mockClear();
  arrangeViewer(OTHER);
  prismaMock.post.findUnique.mockResolvedValue(postRow());
});

describe('reactionService.reactToPost', () => {
  it('adds a reaction, re-derives the total and notifies the author once', async () => {
    prismaMock.postLike.findUnique.mockResolvedValue(null);
    prismaMock.postLike.groupBy.mockResolvedValue([
      { type: 'CELEBRATE', _count: { _all: 2 } },
      { type: 'LIKE', _count: { _all: 1 } },
    ]);

    const result = await reactionService.reactToPost({ id: OTHER }, 'p1', 'celebrate');

    expect(prismaMock.postLike.create).toHaveBeenCalledWith({ data: { postId: 'p1', userId: OTHER, type: 'CELEBRATE' } });
    expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { likeCount: 3 } });
    expect(result).toEqual({
      reaction: 'CELEBRATE',
      counts: { reactions: 3 },
      reactionSummary: { CELEBRATE: 2, LIKE: 1 },
      topReactions: ['CELEBRATE', 'LIKE'],
    });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWNER,
        type: 'POST_REACTED',
        message: `User ${OTHER} celebrated your post`,
        link: '/posts/p1',
      })
    );
  });

  it('changes an existing reaction without notifying again', async () => {
    prismaMock.postLike.findUnique.mockResolvedValue({ type: 'LIKE' });
    prismaMock.postLike.groupBy.mockResolvedValue([{ type: 'LOVE', _count: { _all: 1 } }]);

    const result = await reactionService.reactToPost({ id: OTHER }, 'p1', 'LOVE');

    expect(prismaMock.postLike.update).toHaveBeenCalledWith({
      where: { postId_userId: { postId: 'p1', userId: OTHER } },
      data: { type: 'LOVE' },
    });
    expect(result.reaction).toBe('LOVE');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('removes the reaction when the same type is sent again', async () => {
    prismaMock.postLike.findUnique.mockResolvedValue({ type: 'LIKE' });
    prismaMock.postLike.groupBy.mockResolvedValue(undefined);

    const result = await reactionService.reactToPost({ id: OTHER }, 'p1', 'LIKE');

    expect(prismaMock.postLike.deleteMany).toHaveBeenCalledWith({ where: { postId: 'p1', userId: OTHER } });
    expect(result).toEqual({ reaction: null, counts: { reactions: 0 }, reactionSummary: {}, topReactions: [] });
    expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { likeCount: 0 } });
  });

  it('turns a concurrent duplicate insert into an update', async () => {
    prismaMock.postLike.findUnique.mockResolvedValue(null);
    prismaMock.postLike.create.mockRejectedValue(dup());
    prismaMock.postLike.groupBy.mockResolvedValue([{ type: 'SUPPORT', _count: undefined }]);

    const result = await reactionService.reactToPost({ id: OTHER }, 'p1', 'SUPPORT');

    expect(prismaMock.postLike.update).toHaveBeenCalled();
    expect(result.reaction).toBe('SUPPORT');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('propagates unexpected insert errors', async () => {
    prismaMock.postLike.findUnique.mockResolvedValue(null);
    prismaMock.postLike.create.mockRejectedValue(new Error('db down'));
    await expect(reactionService.reactToPost({ id: OTHER }, 'p1', 'LIKE')).rejects.toThrow('db down');
  });

  it('does not notify for reactions to your own post', async () => {
    arrangeViewer(OWNER);
    prismaMock.postLike.findUnique.mockResolvedValue(null);
    prismaMock.postLike.groupBy.mockResolvedValue([]);
    await reactionService.reactToPost({ id: OWNER }, 'p1', 'LIKE');
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('validates the type and 404s for posts the viewer cannot see', async () => {
    await expect(reactionService.reactToPost({ id: OTHER }, 'p1', 'ANGRY')).rejects.toMatchObject({ statusCode: 400 });
    prismaMock.post.findUnique.mockResolvedValue(postRow({ visibility: 'CONNECTIONS' }));
    await expect(reactionService.reactToPost({ id: OTHER }, 'p1', 'LIKE')).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(reactionService.reactToPost({ id: OTHER }, 'p1', 'LIKE')).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.postLike.create).not.toHaveBeenCalled();
  });
});

describe('reactionService.toggleLike (v1)', () => {
  it('likes when there is no reaction and removes any existing reaction', async () => {
    prismaMock.postLike.findUnique.mockResolvedValue(null);
    prismaMock.postLike.groupBy.mockResolvedValue([{ type: 'LIKE', _count: { _all: 1 } }]);
    await expect(reactionService.toggleLike({ id: OTHER }, 'p1')).resolves.toEqual({ liked: true, likeCount: 1, reaction: 'LIKE' });

    prismaMock.postLike.findUnique.mockResolvedValue({ type: 'FUNNY' });
    prismaMock.postLike.groupBy.mockResolvedValue([]);
    await expect(reactionService.toggleLike({ id: OTHER }, 'p1')).resolves.toEqual({ liked: false, likeCount: 0, reaction: null });
    expect(prismaMock.postLike.deleteMany).toHaveBeenCalled();
  });
});

describe('reactionService.listPostReactions', () => {
  it('pages reactors newest first, optionally by type', async () => {
    prismaMock.postLike.findMany.mockResolvedValue([{ type: 'LIKE', user: { id: 'u1' } }]);

    const result = await reactionService.listPostReactions({ id: OTHER }, 'p1', { type: 'like', limit: '10' });

    const args = prismaMock.postLike.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ postId: 'p1', type: 'LIKE' });
    expect(args.take).toBe(11);
    expect(result).toEqual({ items: [{ type: 'LIKE', user: { id: 'u1' } }], nextCursor: null });
  });

  it('lists every type by default and 404s for hidden posts', async () => {
    prismaMock.postLike.findMany.mockResolvedValue(undefined);
    await expect(reactionService.listPostReactions({ id: OTHER }, 'p1', { type: '' })).resolves.toEqual({ items: [], nextCursor: null });
    expect(prismaMock.postLike.findMany.mock.calls[0][0].where).not.toHaveProperty('type');

    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(reactionService.listPostReactions({ id: OTHER }, 'p1', {})).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('reactionService.reactToComment', () => {
  beforeEach(() => {
    prismaMock.postComment.findUnique.mockResolvedValue({ ...commentRow({ userId: OWNER }), post: postRow() });
  });

  it('adds a reaction, re-derives likeCount and notifies the comment author', async () => {
    prismaMock.commentReaction.findUnique.mockResolvedValue(null);
    prismaMock.commentReaction.count.mockResolvedValue(4);

    await expect(reactionService.reactToComment({ id: OTHER }, 'c1', 'INSIGHTFUL')).resolves.toEqual({ reaction: 'INSIGHTFUL', likeCount: 4 });
    expect(prismaMock.postComment.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { likeCount: 4 } });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OWNER,
        type: 'COMMENT_REACTED',
        message: `User ${OTHER} found your comment insightful`,
        link: '/posts/p1#comment-c1',
      })
    );
  });

  it('changes or removes an existing reaction without notifying', async () => {
    prismaMock.commentReaction.findUnique.mockResolvedValue({ type: 'LIKE' });
    prismaMock.commentReaction.count.mockResolvedValue(undefined);
    await expect(reactionService.reactToComment({ id: OTHER }, 'c1', 'LOVE')).resolves.toEqual({ reaction: 'LOVE', likeCount: 0 });
    expect(prismaMock.commentReaction.update).toHaveBeenCalled();

    await expect(reactionService.reactToComment({ id: OTHER }, 'c1', 'LIKE')).resolves.toMatchObject({ reaction: null });
    expect(prismaMock.commentReaction.deleteMany).toHaveBeenCalledWith({ where: { commentId: 'c1', userId: OTHER } });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('handles a concurrent duplicate and propagates other errors', async () => {
    prismaMock.commentReaction.findUnique.mockResolvedValue(null);
    prismaMock.commentReaction.create.mockRejectedValueOnce(dup());
    prismaMock.commentReaction.count.mockResolvedValue(1);
    await expect(reactionService.reactToComment({ id: OTHER }, 'c1', 'LIKE')).resolves.toEqual({ reaction: 'LIKE', likeCount: 1 });
    expect(createNotification).not.toHaveBeenCalled();

    prismaMock.commentReaction.create.mockRejectedValueOnce(new Error('db down'));
    await expect(reactionService.reactToComment({ id: OTHER }, 'c1', 'LIKE')).rejects.toThrow('db down');
  });

  it('does not notify for your own comment and 404s for hidden or missing comments', async () => {
    prismaMock.postComment.findUnique.mockResolvedValue({ ...commentRow({ userId: OTHER }), post: postRow() });
    prismaMock.commentReaction.findUnique.mockResolvedValue(null);
    await reactionService.reactToComment({ id: OTHER }, 'c1', 'LIKE');
    expect(createNotification).not.toHaveBeenCalled();

    prismaMock.postComment.findUnique.mockResolvedValue({ ...commentRow(), post: postRow({ visibility: 'CONNECTIONS' }) });
    await expect(reactionService.reactToComment({ id: OTHER }, 'c1', 'LIKE')).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.postComment.findUnique.mockResolvedValue(null);
    await expect(reactionService.reactToComment({ id: OTHER }, 'c1', 'LIKE')).rejects.toMatchObject({ statusCode: 404 });
  });
});
