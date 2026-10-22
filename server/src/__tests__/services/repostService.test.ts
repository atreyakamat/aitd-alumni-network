jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { repostService, plainRepostKey } from '../../services/repostService';
import { notificationService } from '../../services/notificationService';
import { POST_CONTENT_MAX_LENGTH } from '../../services/postService';
import { prismaMock } from '../../../tests/helpers';
import { arrangeViewer, OTHER, OWNER, postRow } from '../../../tests/helpers/social';

const createNotification = notificationService.createNotification as jest.Mock;

beforeEach(() => {
  createNotification.mockClear();
  arrangeViewer(OTHER);
  prismaMock.post.findUnique.mockResolvedValue(postRow({ id: 'orig' }));
  prismaMock.post.create.mockImplementation(async ({ data }: any) => postRow({ id: 'new', ...data }));
  prismaMock.post.count.mockResolvedValue(3);
});

describe('repostService.repost', () => {
  it('creates a plain repost of the original and notifies its author', async () => {
    const view = await repostService.repost({ id: OTHER }, 'orig');

    expect(prismaMock.post.create.mock.calls[0][0].data).toEqual({
      userId: OTHER,
      content: '',
      visibility: 'PUBLIC',
      isRepost: true,
      repostOfId: 'orig',
      plainRepostKey: `${OTHER}:orig`,
    });
    expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'orig' }, data: { repostCount: 3 } });
    expect(prismaMock.hashtag.createMany).not.toHaveBeenCalled();
    expect(view).toMatchObject({ id: 'new', isRepost: true, reason: { type: 'REPOST' } });
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER, type: 'POST_REPOSTED', message: `User ${OTHER} reposted your post`, link: '/posts/orig' })
    );
  });

  it('creates a quote post with its own text, hashtags and visibility', async () => {
    prismaMock.hashtag.findMany.mockResolvedValue([{ id: 'h1' }]);

    await repostService.repost({ id: OTHER }, 'orig', { content: '  So proud #Alumni ', visibility: 'CONNECTIONS' });

    expect(prismaMock.post.create.mock.calls[0][0].data).toMatchObject({
      content: 'So proud #Alumni',
      visibility: 'CONNECTIONS',
      plainRepostKey: null,
    });
    expect(prismaMock.hashtag.createMany).toHaveBeenCalled();
    expect(createNotification.mock.calls[0][0]).toMatchObject({ message: `User ${OTHER} shared your post with their thoughts`, link: '/posts/new' });
  });

  it('reposting a repost targets the original', async () => {
    prismaMock.post.findUnique
      .mockResolvedValueOnce(postRow({ id: 'r1', userId: 'someone', isRepost: true, repostOfId: 'orig', content: '' }))
      .mockResolvedValueOnce(postRow({ id: 'orig' }));

    await repostService.repost({ id: OTHER }, 'r1');

    expect(prismaMock.post.create.mock.calls[0][0].data.repostOfId).toBe('orig');
  });

  it('409s on a second plain repost', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(repostService.repost({ id: OTHER }, 'orig')).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_REPOSTED' });
  });

  it('propagates unexpected errors', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('db down'));
    await expect(repostService.repost({ id: OTHER }, 'orig')).rejects.toThrow('db down');
  });

  it.each([
    ['a connections-only post', postRow({ id: 'orig', visibility: 'CONNECTIONS', userId: 'friend' }), ['friend']],
    ['an unpublished post', postRow({ id: 'orig', isPublished: false, userId: OTHER }), []],
  ])('403s NOT_REPOSTABLE for %s', async (_label, post, connections) => {
    arrangeViewer(OTHER, { connections: connections as string[] });
    prismaMock.post.findUnique.mockResolvedValue(post);
    await expect(repostService.repost({ id: OTHER }, 'orig', { content: 'x' })).rejects.toMatchObject({ statusCode: 403, code: 'NOT_REPOSTABLE' });
  });

  it('403s when the original of a repost is gone or hidden', async () => {
    prismaMock.post.findUnique.mockResolvedValueOnce(postRow({ id: 'r1', isRepost: true, repostOfId: null, content: 'q' }));
    await expect(repostService.repost({ id: OTHER }, 'r1')).rejects.toMatchObject({ code: 'NOT_REPOSTABLE' });

    prismaMock.post.findUnique
      .mockResolvedValueOnce(postRow({ id: 'r1', isRepost: true, repostOfId: 'orig', content: 'q' }))
      .mockResolvedValueOnce(null);
    await expect(repostService.repost({ id: OTHER }, 'r1')).rejects.toMatchObject({ code: 'NOT_REPOSTABLE' });
  });

  it('does not let you plain-repost your own post, but you may quote it (without notifying yourself)', async () => {
    arrangeViewer(OWNER);
    await expect(repostService.repost({ id: OWNER }, 'orig')).rejects.toMatchObject({ statusCode: 403 });
    await repostService.repost({ id: OWNER }, 'orig', { content: 'Still true' });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('validates content and 404s for invisible posts', async () => {
    await expect(repostService.repost({ id: OTHER }, 'orig', { content: 5 })).rejects.toMatchObject({ statusCode: 400 });
    await expect(repostService.repost({ id: OTHER }, 'orig', { content: 'a'.repeat(POST_CONTENT_MAX_LENGTH + 1) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(repostService.repost({ id: OTHER }, 'orig', { content: 'x', visibility: 'NOPE' })).rejects.toMatchObject({ statusCode: 400 });
    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(repostService.repost({ id: OTHER }, 'orig')).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.post.create).not.toHaveBeenCalled();
  });

  it('counts zero reposts when the count comes back empty', async () => {
    prismaMock.post.count.mockResolvedValue(undefined);
    await repostService.repost({ id: OTHER }, 'orig', { content: null as any });
    expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'orig' }, data: { repostCount: 0 } });
  });
});

describe('repostService.undoRepost', () => {
  it('removes the viewer’s plain repost of the original (also when given the repost’s id)', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 'r1', isRepost: true, repostOfId: 'orig' });
    prismaMock.post.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.post.count.mockResolvedValue(1);

    await expect(repostService.undoRepost({ id: OTHER }, 'r1')).resolves.toEqual({ reposted: false, counts: { reposts: 1 } });
    expect(prismaMock.post.deleteMany).toHaveBeenCalledWith({ where: { plainRepostKey: plainRepostKey(OTHER, 'orig') } });
  });

  it('404s when there is nothing to undo or no such post', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: 'orig', isRepost: false, repostOfId: null });
    prismaMock.post.deleteMany.mockResolvedValue({ count: 0 });
    await expect(repostService.undoRepost({ id: OTHER }, 'orig')).rejects.toMatchObject({ statusCode: 404, code: 'NOT_REPOSTED' });

    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(repostService.undoRepost({ id: OTHER }, 'orig')).rejects.toMatchObject({ statusCode: 404 });
  });
});
