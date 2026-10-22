jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../middleware/cache', () => ({
  ...jest.requireActual('../../middleware/cache'),
  invalidateCache: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/storage', () => ({
  ...jest.requireActual('../../utils/storage'),
  uploadToStorage: jest.fn(),
}));

import { postController } from '../../controllers/postController';
import { postService } from '../../services/postService';
import { invalidateCache } from '../../middleware/cache';
import { uploadToStorage } from '../../utils/storage';
import { api, authAs, mockReqRes, prismaMock, USER_IDS } from '../../../tests/helpers';
import { commentRow, postRow } from '../../../tests/helpers/social';

const invalidate = invalidateCache as jest.Mock;
const upload = uploadToStorage as jest.Mock;

const member = { id: USER_IDS.MEMBER, userRole: 'MEMBER' };
const admin = { id: USER_IDS.ADMIN, userRole: 'ADMIN' };
const boom = new Error('boom');

// Restore only our service spies: jest.restoreAllMocks() would also undo the
// harness's console silencing.
const restoreServiceSpies = () => {
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(postService))) {
    const fn = (postService as any)[key];
    if (jest.isMockFunction(fn)) fn.mockRestore();
  }
};

afterEach(() => {
  restoreServiceSpies();
  invalidate.mockClear();
  upload.mockReset();
});

describe('postController (handlers)', () => {
  describe('getFeed', () => {
    it('parses pagination and spreads the paginated result', async () => {
      const spy = jest.spyOn(postService, 'getFeed').mockResolvedValue({ data: [], pagination: { total: 0 } } as any);
      const { req, res, next } = mockReqRes({ user: member, query: { page: '3', limit: '5' } });

      await postController.getFeed(req, res, next);

      expect(spy).toHaveBeenCalledWith(member.id, 3, 5, member);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [], pagination: { total: 0 } });
    });

    it('defaults pagination and works anonymously', async () => {
      const spy = jest.spyOn(postService, 'getFeed').mockResolvedValue({ data: [], pagination: {} } as any);
      const { req, res, next } = mockReqRes({ query: { page: 'abc' } });

      await postController.getFeed(req, res, next);

      expect(spy).toHaveBeenCalledWith(undefined, 1, 20, undefined);
    });

    it('forwards errors', async () => {
      jest.spyOn(postService, 'getFeed').mockRejectedValue(boom);
      const { req, res, next } = mockReqRes();
      await postController.getFeed(req, res, next);
      expect(next).toHaveBeenCalledWith(boom);
    });
  });

  describe('getPost', () => {
    it('passes the viewer (role included) to the service', async () => {
      const spy = jest.spyOn(postService, 'getPost').mockResolvedValue({ id: 'p1' } as any);

      const r1 = mockReqRes({ user: admin, params: { id: 'p1' } });
      await postController.getPost(r1.req, r1.res, r1.next);
      expect(spy).toHaveBeenLastCalledWith('p1', admin);
      expect(r1.res.json).toHaveBeenCalledWith({ success: true, data: { id: 'p1' } });

      const r2 = mockReqRes({ params: { id: 'p1' } });
      await postController.getPost(r2.req, r2.res, r2.next);
      expect(spy).toHaveBeenLastCalledWith('p1', undefined);
    });

    it('forwards errors', async () => {
      jest.spyOn(postService, 'getPost').mockRejectedValue(boom);
      const { req, res, next } = mockReqRes({ params: { id: 'p1' } });
      await postController.getPost(req, res, next);
      expect(next).toHaveBeenCalledWith(boom);
    });
  });

  describe('createPost', () => {
    it('creates, invalidates the feed cache and returns 201', async () => {
      const spy = jest.spyOn(postService, 'createPost').mockResolvedValue({ id: 'p1' } as any);
      const { req, res, next } = mockReqRes({ user: member, body: { content: 'hi' } });

      await postController.createPost(req, res, next);

      expect(spy).toHaveBeenCalledWith(member.id, { content: 'hi' });
      expect(invalidate).toHaveBeenCalledWith('cache:/api/posts*');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'p1' } });
    });

    it('forwards errors without invalidating', async () => {
      jest.spyOn(postService, 'createPost').mockRejectedValue(boom);
      const { req, res, next } = mockReqRes({ user: member, body: {} });
      await postController.createPost(req, res, next);
      expect(next).toHaveBeenCalledWith(boom);
      expect(invalidate).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['MEMBER', member, false],
    ['ADMIN', admin, true],
    ['SUPER_ADMIN', { id: USER_IDS.SUPER_ADMIN, userRole: 'SUPER_ADMIN' }, true],
    ['CHAPTER_ADMIN', { id: USER_IDS.CHAPTER_ADMIN, userRole: 'CHAPTER_ADMIN' }, false],
  ])('admin flag for %s', (_role, user, isAdmin) => {
    it('updatePost', async () => {
      const spy = jest.spyOn(postService, 'updatePost').mockResolvedValue({ id: 'p1' } as any);
      const { req, res, next } = mockReqRes({ user, params: { id: 'p1' }, body: { content: 'x' } });
      await postController.updatePost(req, res, next);
      expect(spy).toHaveBeenCalledWith(user.id, 'p1', { content: 'x' }, isAdmin);
      expect(invalidate).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'p1' } });
    });

    it('deletePost', async () => {
      const spy = jest.spyOn(postService, 'deletePost').mockResolvedValue({ message: 'ok' });
      const { req, res, next } = mockReqRes({ user, params: { id: 'p1' } });
      await postController.deletePost(req, res, next);
      expect(spy).toHaveBeenCalledWith(user.id, 'p1', isAdmin);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { message: 'ok' } });
    });

    it('deleteComment', async () => {
      const spy = jest.spyOn(postService, 'deleteComment').mockResolvedValue({ message: 'ok' });
      const { req, res, next } = mockReqRes({ user, params: { id: 'c1' } });
      await postController.deleteComment(req, res, next);
      expect(spy).toHaveBeenCalledWith(user.id, 'c1', isAdmin);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { message: 'ok' } });
    });
  });

  describe('updateComment', () => {
    it.each([['member', member], ['admin', admin]] as const)(
      'passes only the caller id, comment id, content and mentions for a %s (no admin override)',
      async (_label, user) => {
        const spy = jest.spyOn(postService, 'updateComment').mockResolvedValue({ id: 'c1', content: 'new' } as any);
        const { req, res, next } = mockReqRes({ user, params: { id: 'c1' }, body: { content: 'new', userId: 'spoof' } });
        await postController.updateComment(req, res, next);
        expect(spy).toHaveBeenCalledWith(user.id, 'c1', 'new', undefined);
        expect(invalidate).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'c1', content: 'new' } });
      }
    );
  });

  it.each(['updatePost', 'deletePost', 'deleteComment', 'updateComment', 'likePost', 'addComment'] as const)(
    '%s forwards service errors',
    async (method) => {
      jest.spyOn(postService, method as any).mockRejectedValue(boom);
      const { req, res, next } = mockReqRes({ user: member, params: { id: 'x', postId: 'x' }, body: {} });
      await (postController as any)[method](req, res, next);
      expect(next).toHaveBeenCalledWith(boom);
      expect(res.json).not.toHaveBeenCalled();
    }
  );

  describe('likePost', () => {
    it('toggles the like for the caller', async () => {
      const spy = jest.spyOn(postService, 'likePost').mockResolvedValue({ liked: true, likeCount: 1, reaction: 'LIKE' });
      const { req, res, next } = mockReqRes({ user: member, params: { id: 'p1' } });
      await postController.likePost(req, res, next);
      expect(spy).toHaveBeenCalledWith(member.id, 'p1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { liked: true, likeCount: 1, reaction: 'LIKE' } });
    });
  });

  describe('addComment', () => {
    it('passes content, parentId and mentions and returns 201', async () => {
      const spy = jest.spyOn(postService, 'addComment').mockResolvedValue({ id: 'c1' } as any);
      const { req, res, next } = mockReqRes({
        user: member,
        params: { postId: 'p1' },
        body: { content: 'hey', parentId: 'c0', mentionIds: ['u2'], userId: 'spoof' },
      });
      await postController.addComment(req, res, next);
      expect(spy).toHaveBeenCalledWith(member.id, 'p1', 'hey', 'c0', ['u2']);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('uploadMedia', () => {
    it('400s when no files were uploaded', async () => {
      const { req, res, next } = mockReqRes({ user: member });
      await postController.uploadMedia(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);

      const r2 = mockReqRes({ user: member, files: [] });
      await postController.uploadMedia(r2.req, r2.res, r2.next);
      expect(r2.res.status).toHaveBeenCalledWith(400);
      expect(upload).not.toHaveBeenCalled();
    });

    it('uploads every file to the posts folder', async () => {
      upload.mockResolvedValueOnce('https://cdn/1').mockResolvedValueOnce('https://cdn/2');
      const files = [{ originalname: 'a.png' }, { originalname: 'b.png' }];
      const { req, res, next } = mockReqRes({ user: member, files });

      await postController.uploadMedia(req, res, next);

      expect(upload).toHaveBeenCalledWith(files[0], 'posts');
      expect(upload).toHaveBeenCalledWith(files[1], 'posts');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { urls: ['https://cdn/1', 'https://cdn/2'] } });
    });

    it('forwards storage errors', async () => {
      upload.mockRejectedValue(boom);
      const { req, res, next } = mockReqRes({ user: member, files: [{}] });
      await postController.uploadMedia(req, res, next);
      expect(next).toHaveBeenCalledWith(boom);
    });
  });
});

describe('post routes (through real services)', () => {
  const POST_ID = '11111111-1111-4111-8111-111111111111';

  it('PATCH /api/posts/:id → 403 for a member editing someone else’s post', async () => {
    const { header } = authAs('MEMBER');
    prismaMock.post.findUnique.mockResolvedValue({ id: POST_ID, userId: 'someone-else', isPublished: true });

    const res = await api().patch(`/api/posts/${POST_ID}`).set('Authorization', header).send({ content: 'hijack' });

    expect(res.status).toBe(403);
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/posts/:id → admin may pin, counters are stripped', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.post.findUnique.mockResolvedValue({ id: POST_ID, userId: 'someone-else', isPublished: true });
    prismaMock.post.update.mockResolvedValue(postRow({ id: POST_ID, userId: 'someone-else', isPinned: true }));

    const res = await api()
      .patch(`/api/posts/${POST_ID}`)
      .set('Authorization', header)
      .send({ isPinned: true, likeCount: 1_000_000 });

    expect(res.status).toBe(200);
    expect(prismaMock.post.update.mock.calls[0][0].data).toEqual({ isPinned: true });
  });

  it('POST /api/posts/:postId/comments → 400 on empty content', async () => {
    const { header } = authAs('MEMBER');
    const res = await api().post(`/api/posts/${POST_ID}/comments`).set('Authorization', header).send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('POST /api/posts/:postId/comments → 404 for an unpublished post', async () => {
    const { header } = authAs('MEMBER');
    prismaMock.post.findUnique.mockResolvedValue({ id: POST_ID, userId: 'x', isPublished: false });
    const res = await api().post(`/api/posts/${POST_ID}/comments`).set('Authorization', header).send({ content: 'hi' });
    expect(res.status).toBe(404);
  });

  it('GET /api/posts/:id → 404 for an unpublished post viewed anonymously', async () => {
    prismaMock.post.findUnique.mockResolvedValue({ id: POST_ID, userId: 'x', isPublished: false, _count: { likes: 0, comments: 0 } });
    const res = await api().get(`/api/posts/${POST_ID}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/comments/:id → 401 without a token', async () => {
    const res = await api().delete('/api/comments/c1');
    expect(res.status).toBe(401);
  });

  describe('PATCH /api/comments/:id', () => {
    const COMMENT_ID = '22222222-2222-4222-8222-222222222222';

    it('401 without a token', async () => {
      const res = await api().patch(`/api/comments/${COMMENT_ID}`).send({ content: 'x' });
      expect(res.status).toBe(401);
    });

    it('200 for the author, returning the trimmed comment', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.postComment.findUnique.mockResolvedValue({ id: COMMENT_ID, postId: POST_ID, userId: user.id, content: 'old' });
      prismaMock.postComment.update.mockResolvedValue(commentRow({ id: COMMENT_ID, content: 'edited', userId: user.id }));

      const res = await api()
        .patch(`/api/comments/${COMMENT_ID}`)
        .set('Authorization', header)
        .send({ content: '  edited  ', userId: 'spoof' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: COMMENT_ID, content: 'edited' });
      expect(prismaMock.postComment.update.mock.calls[0][0].data).toEqual({ content: 'edited', editedAt: expect.any(Date) });
    });

    it('403 for an admin editing someone else’s comment', async () => {
      const { header } = authAs('ADMIN');
      prismaMock.postComment.findUnique.mockResolvedValue({ id: COMMENT_ID, postId: POST_ID, userId: 'someone-else' });

      const res = await api().patch(`/api/comments/${COMMENT_ID}`).set('Authorization', header).send({ content: 'rewrite' });

      expect(res.status).toBe(403);
      expect(prismaMock.postComment.update).not.toHaveBeenCalled();
    });

    it('404 for a missing comment', async () => {
      const { header } = authAs('MEMBER');
      prismaMock.postComment.findUnique.mockResolvedValue(null);
      const res = await api().patch(`/api/comments/${COMMENT_ID}`).set('Authorization', header).send({ content: 'x' });
      expect(res.status).toBe(404);
    });

    it.each([
      ['empty', { content: '' }],
      ['whitespace', { content: '    ' }],
      ['missing', {}],
      ['oversized', { content: 'a'.repeat(2001) }],
    ])('400 for %s content', async (_label, body) => {
      const { header } = authAs('MEMBER');
      const res = await api().patch(`/api/comments/${COMMENT_ID}`).set('Authorization', header).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(prismaMock.postComment.update).not.toHaveBeenCalled();
    });
  });
});
