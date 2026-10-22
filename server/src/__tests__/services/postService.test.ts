jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { postService, POST_CONTENT_MAX_LENGTH, COMMENT_CONTENT_MAX_LENGTH, MAX_MEDIA_URLS } from '../../services/postService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';
import { arrangeViewer, commentRow, OTHER, OWNER, postRow, THIRD } from '../../../tests/helpers/social';

const createNotification = notificationService.createNotification as jest.Mock;
const ADMIN = { id: 'admin', userRole: 'ADMIN' };

beforeEach(() => {
  createNotification.mockClear();
});

describe('postService', () => {
  describe('getFeed (v1)', () => {
    it('lists visible posts, paginates and flags posts the viewer reacted to', async () => {
      arrangeViewer('viewer', { connections: ['friend'] });
      prismaMock.post.findMany.mockResolvedValue([postRow({ id: 'p1', likeCount: 3, commentCount: 1 }), postRow({ id: 'p2' })]);
      prismaMock.post.count.mockResolvedValue(42);
      prismaMock.postLike.findMany.mockResolvedValue([{ postId: 'p2', type: 'LIKE' }]);

      const result = await postService.getFeed('viewer', 2, 10);

      const args = prismaMock.post.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        isPublished: true,
        user: { isActive: true },
        OR: [{ visibility: 'PUBLIC' }, { userId: 'viewer' }, { userId: { in: ['friend'] } }],
      });
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(args.orderBy).toEqual([{ isPinned: 'desc' }, { createdAt: 'desc' }]);
      expect(result.data.map((p: any) => [p.id, p.likeCount, p.commentCount, p.isLiked])).toEqual([
        ['p1', 3, 1, false],
        ['p2', 0, 0, true],
      ]);
      expect(result.pagination).toMatchObject({ total: 42, page: 2, limit: 10, totalPages: 5, hasNextPage: true, hasPrevPage: true });
    });

    it('shows anonymous visitors public posts only and skips viewer lookups', async () => {
      prismaMock.post.findMany.mockResolvedValue([postRow()]);
      prismaMock.post.count.mockResolvedValue(1);

      const result = await postService.getFeed(undefined);

      expect(prismaMock.post.findMany.mock.calls[0][0].where).toEqual({ isPublished: true, user: { isActive: true }, visibility: 'PUBLIC' });
      expect(prismaMock.postLike.findMany).not.toHaveBeenCalled();
      expect(result.data[0].isLiked).toBe(false);
    });

    it('clamps abusive page sizes', async () => {
      prismaMock.post.findMany.mockResolvedValue([]);
      prismaMock.post.count.mockResolvedValue(0);

      const result = await postService.getFeed(undefined, -5, 10_000);

      const args = prismaMock.post.findMany.mock.calls[0][0];
      expect(args.take).toBe(100);
      expect(args.skip).toBe(0);
      expect(result.pagination).toMatchObject({ page: 1, limit: 100 });
    });
  });

  describe('getPost', () => {
    it('returns the PostView with counts, viewer state and the v1 comment tree', async () => {
      arrangeViewer(OTHER);
      prismaMock.post.findUnique.mockResolvedValue(postRow({ likeCount: 2, commentCount: 5 }));
      prismaMock.postLike.findMany.mockResolvedValue([{ postId: 'p1', type: 'CELEBRATE' }]);
      prismaMock.postComment.findMany.mockResolvedValue([{ id: 'c1', replies: [] }]);

      const post = await postService.getPost('p1', { id: OTHER });

      expect(post).toMatchObject({
        id: 'p1',
        likeCount: 2,
        commentCount: 5,
        isLiked: true,
        counts: { reactions: 2, comments: 5, reposts: 0, views: 0 },
        viewer: { reaction: 'CELEBRATE', isAuthor: false },
        comments: [{ id: 'c1', replies: [] }],
      });
    });

    it('returns isLiked=false for anonymous viewers without querying their reactions', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      prismaMock.postComment.findMany.mockResolvedValue(undefined);
      const post = await postService.getPost('p1');
      expect(post.isLiked).toBe(false);
      expect(post.comments).toEqual([]);
      expect(prismaMock.postLike.findMany).not.toHaveBeenCalled();
    });

    it('404s for a missing post', async () => {
      prismaMock.post.findUnique.mockResolvedValue(null);
      await expect(postService.getPost('nope', { id: OTHER })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('hides unpublished posts from other members and anonymous viewers', async () => {
      arrangeViewer(OTHER);
      prismaMock.post.findUnique.mockResolvedValue(postRow({ isPublished: false }));
      await expect(postService.getPost('p1', { id: OTHER })).rejects.toMatchObject({ statusCode: 404 });
      await expect(postService.getPost('p1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('shows unpublished posts to their author and to admins', async () => {
      arrangeViewer(OWNER);
      prismaMock.post.findUnique.mockResolvedValue(postRow({ isPublished: false }));
      prismaMock.postComment.findMany.mockResolvedValue([]);
      await expect(postService.getPost('p1', { id: OWNER })).resolves.toMatchObject({ id: 'p1' });
      await expect(postService.getPost('p1', ADMIN)).resolves.toMatchObject({ id: 'p1' });
    });

    it('shows CONNECTIONS posts only to the author’s connections', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow({ visibility: 'CONNECTIONS' }));
      prismaMock.postComment.findMany.mockResolvedValue([]);

      arrangeViewer(OTHER, { connections: [OWNER] });
      await expect(postService.getPost('p1', { id: OTHER })).resolves.toMatchObject({ visibility: 'CONNECTIONS' });

      arrangeViewer(THIRD);
      await expect(postService.getPost('p1', { id: THIRD })).rejects.toMatchObject({ statusCode: 404 });
      await expect(postService.getPost('p1')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('hides posts by deactivated authors', async () => {
      arrangeViewer(OTHER);
      prismaMock.post.findUnique.mockResolvedValue(postRow({ user: { ...postRow().user, isActive: false } }));
      await expect(postService.getPost('p1', { id: OTHER })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('createPost', () => {
    beforeEach(() => {
      arrangeViewer(OWNER);
      prismaMock.post.create.mockImplementation(async ({ data }: any) => postRow({ id: 'new', ...data }));
    });

    it('creates a trimmed public GENERAL post by default', async () => {
      const view = await postService.createPost(OWNER, { content: '  hi there  ' });

      expect(prismaMock.post.create.mock.calls[0][0].data).toEqual({
        userId: OWNER,
        type: 'GENERAL',
        content: 'hi there',
        mediaUrls: [],
        videoUrl: null,
        thumbnailUrl: null,
        isReel: false,
        visibility: 'PUBLIC',
        linkUrl: undefined,
      });
      expect(view).toMatchObject({ id: 'new', content: 'hi there', viewer: { isAuthor: true } });
    });

    it('accepts type, media, link and visibility', async () => {
      await postService.createPost(OWNER, {
        content: 'x',
        type: 'JOB',
        mediaUrls: ['https://a/1.png'],
        linkUrl: 'https://l',
        visibility: 'connections',
      });
      expect(prismaMock.post.create.mock.calls[0][0].data).toMatchObject({
        type: 'JOB',
        mediaUrls: ['https://a/1.png'],
        linkUrl: 'https://l',
        visibility: 'CONNECTIONS',
      });
    });

    it('parses hashtags into the post’s tags', async () => {
      prismaMock.hashtag.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);

      await postService.createPost(OWNER, { content: 'Hiring! #Placements #batch2015 #placements' });

      expect(prismaMock.hashtag.createMany).toHaveBeenCalledWith({
        data: [{ tag: 'placements' }, { tag: 'batch2015' }],
        skipDuplicates: true,
      });
      expect(prismaMock.postHashtag.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ postId: 'new', hashtagId: 'h1' }),
        expect.objectContaining({ postId: 'new', hashtagId: 'h2' }),
      ]);
    });

    it('stores mentions of active members and notifies them once', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: OTHER }]);

      await postService.createPost(OWNER, { content: 'thanks @Other', mentionIds: [OTHER, OTHER, 'ghost', OWNER] });

      expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: [OTHER, 'ghost'] }, isActive: true });
      expect(prismaMock.postMention.createMany).toHaveBeenCalledWith({ data: [{ postId: 'new', userId: OTHER }], skipDuplicates: true });
      expect(createNotification).toHaveBeenCalledTimes(1);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OTHER, type: 'MENTION', link: '/posts/new' })
      );
    });

    it('rejects malformed or too many mentions', async () => {
      await expect(postService.createPost(OWNER, { content: 'x', mentionIds: 'u1' as any })).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        postService.createPost(OWNER, { content: 'x', mentionIds: Array.from({ length: 21 }, (_, i) => `u${i}`) })
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('allows a media-only post and a reel with an uploaded video', async () => {
      await postService.createPost(OWNER, { mediaUrls: ['/uploads/posts/a.jpg'] });
      expect(prismaMock.post.create.mock.calls[0][0].data.content).toBe('');

      await postService.createPost(OWNER, {
        content: 'campus tour',
        videoUrl: '/uploads/videos/v.mp4',
        thumbnailUrl: '/uploads/posts/t.jpg',
        isReel: true,
      });
      expect(prismaMock.post.create.mock.calls[1][0].data).toMatchObject({
        videoUrl: '/uploads/videos/v.mp4',
        thumbnailUrl: '/uploads/posts/t.jpg',
        isReel: true,
      });
    });

    it('rejects a reel without a video and videos hosted elsewhere', async () => {
      await expect(postService.createPost(OWNER, { content: 'x', isReel: true })).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        postService.createPost(OWNER, { content: 'x', videoUrl: 'https://evil.example/v.mp4' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_MEDIA_URL' });
      await expect(
        postService.createPost(OWNER, { content: 'x', thumbnailUrl: 42 as any })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.post.create).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['whitespace', '   '],
      ['non-string', 42],
      ['oversized', 'a'.repeat(POST_CONTENT_MAX_LENGTH + 1)],
    ])('rejects %s content (and no media) with 400', async (_label, content) => {
      await expect(postService.createPost(OWNER, { content } as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.post.create).not.toHaveBeenCalled();
    });

    it('rejects a missing body', async () => {
      await expect(postService.createPost(OWNER, undefined as any)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('accepts content exactly at the limit', async () => {
      await expect(postService.createPost(OWNER, { content: 'a'.repeat(POST_CONTENT_MAX_LENGTH) })).resolves.toBeDefined();
    });

    it('caps and validates mediaUrls, type and visibility', async () => {
      const mediaUrls = Array.from({ length: MAX_MEDIA_URLS + 1 }, (_, i) => `https://m/${i}.png`);
      await expect(postService.createPost(OWNER, { content: 'x', mediaUrls })).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.createPost(OWNER, { content: 'x', mediaUrls: 'nope' as any })).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.createPost(OWNER, { content: 'x', mediaUrls: [''] })).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.createPost(OWNER, { content: 'x', type: 'SPAM' as any })).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.createPost(OWNER, { content: 'x', visibility: 'SECRET' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('ignores repost fields from the body', async () => {
      await postService.createPost(OWNER, { content: 'x', isRepost: true, repostOfId: 'p9', likeCount: 99 } as any);
      const data = prismaMock.post.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('isRepost');
      expect(data).not.toHaveProperty('repostOfId');
      expect(data).not.toHaveProperty('likeCount');
    });
  });

  describe('updatePost', () => {
    beforeEach(() => {
      arrangeViewer(OWNER);
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      prismaMock.post.update.mockImplementation(async ({ data }: any) => postRow({ ...data }));
    });

    const updateData = () => {
      const { editedAt, ...rest } = prismaMock.post.update.mock.calls[0][0].data;
      return { editedAt, rest };
    };

    it('lets the owner edit whitelisted fields only and marks the post edited', async () => {
      await postService.updatePost(OWNER, 'p1', {
        content: ' edited #News ',
        mediaUrls: ['https://m/1.png'],
        linkUrl: null,
        type: 'BUSINESS',
        visibility: 'CONNECTIONS',
        likeCount: 9999,
        commentCount: -4,
        userId: OTHER,
        isPublished: false,
        id: 'hijack',
      } as any);

      const { editedAt, rest } = updateData();
      expect(prismaMock.post.update.mock.calls[0][0].where).toEqual({ id: 'p1' });
      expect(rest).toEqual({
        content: 'edited #News',
        mediaUrls: ['https://m/1.png'],
        linkUrl: null,
        type: 'BUSINESS',
        visibility: 'CONNECTIONS',
      });
      expect(editedAt).toBeInstanceOf(Date);
      expect(prismaMock.postHashtag.deleteMany).toHaveBeenCalledWith({ where: { postId: 'p1' } });
    });

    it('silently ignores isPinned from non-admins', async () => {
      await postService.updatePost(OWNER, 'p1', { content: 'x', isPinned: true });
      expect(updateData().rest).toEqual({ content: 'x' });
    });

    it('400s when a non-admin sends only isPinned (nothing editable left)', async () => {
      await expect(postService.updatePost(OWNER, 'p1', { isPinned: true })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.post.update).not.toHaveBeenCalled();
    });

    it('lets admins pin any post without marking it edited', async () => {
      await postService.updatePost('admin', 'p1', { isPinned: true }, true);
      expect(prismaMock.post.update.mock.calls[0][0].data).toEqual({ isPinned: true });
    });

    it("never lets admins rewrite someone else's words (moderation is pin or delete)", async () => {
      for (const field of [{ content: 'rewritten' }, { mediaUrls: [] }, { linkUrl: 'https://x' }, { type: 'BUSINESS' }, { visibility: 'PUBLIC' }, { mentionIds: [] }]) {
        await expect(postService.updatePost('admin', 'p1', { ...field, isPinned: true } as any, true))
          .rejects.toMatchObject({ statusCode: 403 });
      }
      expect(prismaMock.post.update).not.toHaveBeenCalled();
    });

    it('lets admins edit and pin their own post', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow({ userId: 'admin' }));
      await postService.updatePost('admin', 'p1', { content: 'mine', isPinned: true }, true);
      expect(updateData().rest).toEqual({ content: 'mine', isPinned: true });
    });

    it('does not mutate the caller payload', async () => {
      const payload = { content: 'x', isPinned: true };
      await postService.updatePost(OWNER, 'p1', payload);
      expect(payload).toEqual({ content: 'x', isPinned: true });
    });

    it('notifies only newly mentioned people and drops removed mentions', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: OTHER }, { id: THIRD }]);
      prismaMock.postMention.findMany.mockResolvedValue([{ userId: OTHER }]);

      await postService.updatePost(OWNER, 'p1', { mentionIds: [OTHER, THIRD] });

      expect(prismaMock.postMention.deleteMany).toHaveBeenCalledWith({ where: { postId: 'p1', userId: { notIn: [OTHER, THIRD] } } });
      expect(prismaMock.postMention.createMany).toHaveBeenCalledWith({ data: [{ postId: 'p1', userId: THIRD }], skipDuplicates: true });
      expect(createNotification).toHaveBeenCalledTimes(1);
      expect(createNotification.mock.calls[0][0]).toMatchObject({ userId: THIRD, type: 'MENTION' });
    });

    it('lets a media post or quote post drop its text, but keeps plain reposts text-free', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow({ mediaUrls: ['/uploads/posts/a.jpg'] }));
      await postService.updatePost(OWNER, 'p1', { content: '' });
      expect(updateData().rest).toEqual({ content: '' });

      prismaMock.post.findUnique.mockResolvedValue(postRow({ isRepost: true, repostOfId: 'p0', content: '' }));
      await expect(postService.updatePost(OWNER, 'p1', { content: 'now with text' })).rejects.toMatchObject({
        statusCode: 400,
        code: 'NOT_EDITABLE',
      });
    });

    it('403s for non-owners and 404s for a missing post', async () => {
      await expect(postService.updatePost(OTHER, 'p1', { content: 'x' })).rejects.toMatchObject({ statusCode: 403 });
      prismaMock.post.findUnique.mockResolvedValue(null);
      await expect(postService.updatePost(OWNER, 'p1', { content: 'x' })).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.post.update).not.toHaveBeenCalled();
    });

    it('validates edited content, media, link, type and visibility', async () => {
      await expect(postService.updatePost(OWNER, 'p1', { content: '' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.updatePost(OWNER, 'p1', { content: 'a'.repeat(POST_CONTENT_MAX_LENGTH + 1) })).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        postService.updatePost(OWNER, 'p1', { mediaUrls: Array(MAX_MEDIA_URLS + 1).fill('https://m') })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.updatePost(OWNER, 'p1', { linkUrl: 5 as any })).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.updatePost(OWNER, 'p1', { type: 'NOPE' as any })).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.updatePost(OWNER, 'p1', { visibility: 'NOPE' })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.post.update).not.toHaveBeenCalled();
    });

    it('400s on an empty or missing body', async () => {
      await expect(postService.updatePost(OWNER, 'p1', {})).rejects.toMatchObject({ statusCode: 400 });
      await expect(postService.updatePost(OWNER, 'p1', undefined as any)).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('deletePost', () => {
    it('lets the owner delete, removing plain reposts of it', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      await expect(postService.deletePost(OWNER, 'p1')).resolves.toEqual({ message: 'Post deleted successfully' });
      expect(prismaMock.post.deleteMany).toHaveBeenCalledWith({ where: { repostOfId: 'p1', isRepost: true, content: '' } });
      expect(prismaMock.post.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    it('re-derives the original’s repost count when a repost is deleted', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow({ isRepost: true, repostOfId: 'p0', content: '' }));
      prismaMock.post.count.mockResolvedValue(2);
      await postService.deletePost(OWNER, 'p1');
      expect(prismaMock.post.updateMany).toHaveBeenCalledWith({ where: { id: 'p0' }, data: { repostCount: 2 } });
    });

    it('lets an admin delete any post', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      await postService.deletePost('admin', 'p1', true);
      expect(prismaMock.post.delete).toHaveBeenCalled();
    });

    it('403s for non-owners and 404s for a missing post', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      await expect(postService.deletePost(OTHER, 'p1')).rejects.toMatchObject({ statusCode: 403 });
      prismaMock.post.findUnique.mockResolvedValue(null);
      await expect(postService.deletePost(OWNER, 'p1')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.post.delete).not.toHaveBeenCalled();
    });
  });

  describe('recordView', () => {
    it('counts the first view by a member once', async () => {
      arrangeViewer(OTHER);
      prismaMock.post.findUnique.mockResolvedValue(postRow({ viewCount: 4 }));
      prismaMock.postImpression.createMany.mockResolvedValue({ count: 1 });
      prismaMock.post.update.mockResolvedValue({ viewCount: 5 });

      await expect(postService.recordView('p1', { id: OTHER })).resolves.toEqual({ views: 5 });
      expect(prismaMock.postImpression.createMany).toHaveBeenCalledWith({ data: [{ postId: 'p1', userId: OTHER }], skipDuplicates: true });
      expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { viewCount: { increment: 1 } }, select: { viewCount: true } });
    });

    it('does not count repeat views, the author’s views or anonymous views', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow({ viewCount: 4 }));

      arrangeViewer(OTHER);
      prismaMock.postImpression.createMany.mockResolvedValue({ count: 0 });
      await expect(postService.recordView('p1', { id: OTHER })).resolves.toEqual({ views: 4 });

      arrangeViewer(OWNER);
      await expect(postService.recordView('p1', { id: OWNER })).resolves.toEqual({ views: 4 });
      await expect(postService.recordView('p1')).resolves.toEqual({ views: 4 });
      expect(prismaMock.post.update).not.toHaveBeenCalled();
    });

    it('falls back to the stored count when the update returns nothing, and 404s for hidden posts', async () => {
      arrangeViewer(OTHER);
      prismaMock.post.findUnique.mockResolvedValue(postRow({ viewCount: undefined }));
      prismaMock.postImpression.createMany.mockResolvedValue({ count: 1 });
      prismaMock.post.update.mockResolvedValue(undefined);
      await expect(postService.recordView('p1', { id: OTHER })).resolves.toEqual({ views: 1 });

      prismaMock.post.findUnique.mockResolvedValue(postRow({ viewCount: undefined }));
      prismaMock.postImpression.createMany.mockResolvedValue(undefined);
      await expect(postService.recordView('p1', { id: OTHER })).resolves.toEqual({ views: 0 });
      await expect(postService.recordView('p1')).resolves.toEqual({ views: 0 });

      prismaMock.post.findUnique.mockResolvedValue(null);
      await expect(postService.recordView('p1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('listComments / listReplies', () => {
    it('lists top-level comments by top engagement with two preview replies each', async () => {
      arrangeViewer(OTHER);
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      prismaMock.postComment.findMany.mockResolvedValue([
        commentRow({ id: 'c1', likeCount: 3, _count: { replies: 4 }, replies: [commentRow({ id: 'r1', parentId: 'c1' })] }),
      ]);
      prismaMock.commentReaction.findMany.mockResolvedValue([{ commentId: 'r1', type: 'LOVE' }]);

      const result = await postService.listComments('p1', { id: OTHER }, {});

      const args = prismaMock.postComment.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ postId: 'p1', parentId: null });
      expect(args.orderBy[0]).toEqual({ likeCount: 'desc' });
      expect(args.include.replies).toMatchObject({ take: 2 });
      expect(args.take).toBe(21);
      expect(result.nextCursor).toBeNull();
      expect(result.items[0]).toMatchObject({
        id: 'c1',
        likeCount: 3,
        replyCount: 4,
        viewer: { reaction: null, isAuthor: true },
        previewReplies: [{ id: 'r1', replyCount: 0, viewer: { reaction: 'LOVE' } }],
      });
    });

    it('sorts newest first on request and rejects unknown sorts', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      prismaMock.postComment.findMany.mockResolvedValue([]);
      await postService.listComments('p1', null, { sort: 'newest' });
      expect(prismaMock.postComment.findMany.mock.calls[0][0].orderBy[0]).toEqual({ createdAt: 'desc' });
      await expect(postService.listComments('p1', null, { sort: 'loudest' })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('404s when the post is not visible', async () => {
      prismaMock.post.findUnique.mockResolvedValue(postRow({ visibility: 'CONNECTIONS' }));
      await expect(postService.listComments('p1', null, {})).rejects.toMatchObject({ statusCode: 404 });
    });

    it('pages replies oldest first', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue({ ...commentRow(), post: postRow() });
      prismaMock.postComment.findMany.mockResolvedValue([commentRow({ id: 'r1', parentId: 'c1' }), commentRow({ id: 'r2', parentId: 'c1' })]);

      const result = await postService.listReplies('c1', null, { limit: '1' });

      const args = prismaMock.postComment.findMany.mock.calls[0][0];
      expect(args.where).toMatchObject({ parentId: 'c1' });
      expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
      expect(result.items.map((c) => c.id)).toEqual(['r1']);
      expect(result.nextCursor).toEqual(expect.any(String));
    });

    it('404s replies of a missing comment', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue(null);
      await expect(postService.listReplies('c1', null, {})).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('addComment', () => {
    beforeEach(() => {
      arrangeViewer(OTHER);
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      prismaMock.postComment.create.mockImplementation(async ({ data }: any) => commentRow({ id: 'c9', ...data, mentions: undefined }));
      prismaMock.postComment.count.mockResolvedValue(3);
    });

    it('creates a trimmed top-level comment, re-derives the counter and notifies the owner', async () => {
      const comment = await postService.addComment(OTHER, 'p1', '  nice  ');

      expect(comment).toMatchObject({ id: 'c9', content: 'nice', parentId: null, mentions: [] });
      expect(prismaMock.postComment.create.mock.calls[0][0].data).toEqual({ postId: 'p1', userId: OTHER, content: 'nice', parentId: null });
      expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { commentCount: 3 } });
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
        userId: OWNER,
        type: 'POST_COMMENTED',
        message: `User ${OTHER} commented on your post`,
        link: '/posts/p1#comment-c9',
        metadata: { postId: 'p1', commenterId: OTHER, commentId: 'c9' },
      }));
    });

    it('replies attach to the top-level comment and notify each person once', async () => {
      // Replying to a reply (r1 under c1, written by the post owner)
      prismaMock.postComment.findUnique.mockResolvedValue({ id: 'r1', postId: 'p1', userId: OWNER, parentId: 'c1' });
      prismaMock.user.findMany.mockResolvedValue([{ id: OWNER }, { id: THIRD }]);

      await postService.addComment(OTHER, 'p1', 'reply', 'r1', [OWNER, THIRD]);

      expect(prismaMock.postComment.create.mock.calls[0][0].data.parentId).toBe('c1');
      expect(prismaMock.commentMention.createMany).toHaveBeenCalled();
      expect(createNotification.mock.calls.map((c) => [c[0].userId, c[0].type])).toEqual([
        [OWNER, 'COMMENT_REPLIED'],
        [THIRD, 'MENTION'],
      ]);
    });

    it('a reply to a top-level comment keeps it as the parent', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue({ id: 'c1', postId: 'p1', userId: THIRD, parentId: null });
      await postService.addComment(OTHER, 'p1', 'reply', 'c1');
      expect(prismaMock.postComment.create.mock.calls[0][0].data.parentId).toBe('c1');
      expect(createNotification.mock.calls.map((c) => c[0].type)).toEqual(['COMMENT_REPLIED', 'POST_COMMENTED']);
    });

    it('404s when the parent comment is on another post or missing', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue({ id: 'parent', postId: 'other-post' });
      await expect(postService.addComment(OTHER, 'p1', 'reply', 'parent')).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.postComment.findUnique.mockResolvedValue(null);
      await expect(postService.addComment(OTHER, 'p1', 'reply', 'ghost')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.postComment.create).not.toHaveBeenCalled();
    });

    it('404s on missing, unpublished or hidden posts', async () => {
      prismaMock.post.findUnique.mockResolvedValue(null);
      await expect(postService.addComment(OTHER, 'p1', 'x')).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.post.findUnique.mockResolvedValue(postRow({ isPublished: false }));
      await expect(postService.addComment(OTHER, 'p1', 'x')).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.post.findUnique.mockResolvedValue(postRow({ visibility: 'CONNECTIONS' }));
      await expect(postService.addComment(OTHER, 'p1', 'x')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.postComment.create).not.toHaveBeenCalled();
    });

    it.each([
      ['empty', ''],
      ['whitespace', '  \n '],
      ['missing', undefined],
      ['oversized', 'a'.repeat(COMMENT_CONTENT_MAX_LENGTH + 1)],
    ])('rejects %s content with 400 before touching the DB', async (_label, content) => {
      await expect(postService.addComment(OTHER, 'p1', content as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.post.findUnique).not.toHaveBeenCalled();
    });

    it('does not notify when commenting on your own post', async () => {
      arrangeViewer(OWNER);
      await postService.addComment(OWNER, 'p1', 'self');
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('falls back to a generic commenter name and a zero count', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.postComment.count.mockResolvedValue(undefined);
      await postService.addComment(OTHER, 'p1', 'x');
      expect(createNotification.mock.calls[0][0].message).toBe('Someone commented on your post');
      expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { commentCount: 0 } });
    });
  });

  describe('deleteComment', () => {
    const comment = { id: 'c1', postId: 'p1', userId: OTHER, post: { userId: OWNER } };

    it('lets the author delete the comment and its replies, re-deriving the counter', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue(comment);
      prismaMock.postComment.count.mockResolvedValue(3);

      await expect(postService.deleteComment(OTHER, 'c1')).resolves.toEqual({ message: 'Comment deleted successfully' });

      expect(prismaMock.postComment.deleteMany).toHaveBeenCalledWith({ where: { parentId: 'c1' } });
      expect(prismaMock.postComment.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1' } });
      expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { commentCount: 3 } });
    });

    it('lets the post author and admins remove comments', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue(comment);
      prismaMock.postComment.count.mockResolvedValue(undefined);
      await postService.deleteComment(OWNER, 'c1');
      await postService.deleteComment('admin', 'c1', true);
      expect(prismaMock.post.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { commentCount: 0 } });
    });

    it('403s for anyone else', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue(comment);
      await expect(postService.deleteComment('stranger', 'c1')).rejects.toMatchObject({ statusCode: 403 });
      prismaMock.postComment.findUnique.mockResolvedValue({ ...comment, post: null });
      await expect(postService.deleteComment('stranger', 'c1')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.postComment.deleteMany).not.toHaveBeenCalled();
    });

    it('404s for a missing comment', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue(null);
      await expect(postService.deleteComment(OTHER, 'c1')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('updateComment', () => {
    const comment = { id: 'c1', postId: 'p1', userId: OTHER, content: 'old' };

    beforeEach(() => {
      arrangeViewer(OTHER);
      prismaMock.postComment.findUnique.mockResolvedValue(comment);
      prismaMock.postComment.update.mockImplementation(async ({ data }: any) => commentRow({ ...data, mentions: undefined }));
    });

    it('lets the author edit, trimming content and marking it edited', async () => {
      const view = await postService.updateComment(OTHER, 'c1', '  new text  ');

      const args = prismaMock.postComment.update.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'c1' });
      expect(args.data.content).toBe('new text');
      expect(args.data.editedAt).toBeInstanceOf(Date);
      expect(view).toMatchObject({ content: 'new text', viewer: { isAuthor: true } });
    });

    it('notifies only newly mentioned people', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: OWNER }, { id: THIRD }]);
      prismaMock.commentMention.findMany.mockResolvedValue([{ userId: OWNER }]);

      await postService.updateComment(OTHER, 'c1', 'hi', [OWNER, THIRD]);

      expect(prismaMock.commentMention.createMany).toHaveBeenCalledWith({ data: [{ commentId: 'c1', userId: THIRD }], skipDuplicates: true });
      expect(createNotification.mock.calls.map((c) => c[0].userId)).toEqual([THIRD]);
    });

    it('403s for anyone else, including the post author and admins', async () => {
      await expect(postService.updateComment(OWNER, 'c1', 'edit')).rejects.toMatchObject({ statusCode: 403 });
      await expect((postService.updateComment as any)('admin', 'c1', 'edit', undefined, true)).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.postComment.update).not.toHaveBeenCalled();
    });

    it('404s for a missing comment', async () => {
      prismaMock.postComment.findUnique.mockResolvedValue(null);
      await expect(postService.updateComment(OTHER, 'c1', 'edit')).rejects.toMatchObject({ statusCode: 404 });
    });

    it.each([
      ['empty', ''],
      ['whitespace', '  \n '],
      ['missing', undefined],
      ['non-string', 42],
      ['oversized', 'a'.repeat(COMMENT_CONTENT_MAX_LENGTH + 1)],
    ])('rejects %s content with 400 before touching the DB', async (_label, content) => {
      await expect(postService.updateComment(OTHER, 'c1', content as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.postComment.findUnique).not.toHaveBeenCalled();
    });

    it('accepts content exactly at the limit', async () => {
      await postService.updateComment(OTHER, 'c1', 'a'.repeat(COMMENT_CONTENT_MAX_LENGTH));
      expect(prismaMock.postComment.update.mock.calls[0][0].data.content).toHaveLength(COMMENT_CONTENT_MAX_LENGTH);
    });
  });

  describe('likePost (v1)', () => {
    it('delegates to the reaction toggle', async () => {
      arrangeViewer(OTHER);
      prismaMock.postLike.findUnique.mockResolvedValue(null);
      prismaMock.post.findUnique.mockResolvedValue(postRow());
      prismaMock.postLike.groupBy.mockResolvedValue([{ type: 'LIKE', _count: { _all: 1 } }]);

      await expect(postService.likePost(OTHER, 'p1')).resolves.toEqual({ liked: true, likeCount: 1, reaction: 'LIKE' });
    });
  });
});
