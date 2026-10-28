import path from 'path';
import fs from 'fs';
import os from 'os';
import { api, authAs } from '../../../tests/helpers';
import { feedService } from '../../services/feedService';
import { followService } from '../../services/followService';
import { hashtagService } from '../../services/hashtagService';
import { postService } from '../../services/postService';
import { reactionService } from '../../services/reactionService';
import { reportService } from '../../services/reportService';
import { repostService } from '../../services/repostService';
import * as storage from '../../utils/storage';
import { AppError } from '../../middleware/errorHandler';

const P = '11111111-1111-4111-8111-111111111111';
const page = { items: [], nextCursor: null };

afterEach(() => jest.restoreAllMocks());

describe('social routes (HTTP)', () => {
  it.each([
    ['get', '/api/feed?tab=following&limit=5', feedService, 'getFeed', 200],
    ['get', '/api/saved', feedService, 'getSaved', 200],
    ['post', `/api/posts/${P}/save`, feedService, 'toggleSave', 200],
    ['post', `/api/posts/${P}/react`, reactionService, 'reactToPost', 200],
    ['get', `/api/posts/${P}/reactions?type=LIKE`, reactionService, 'listPostReactions', 200],
    ['post', `/api/comments/${P}/react`, reactionService, 'reactToComment', 200],
    ['post', `/api/posts/${P}/repost`, repostService, 'repost', 201],
    ['delete', `/api/posts/${P}/repost`, repostService, 'undoRepost', 200],
    ['post', `/api/users/${P}/follow`, followService, 'follow', 200],
    ['delete', `/api/users/${P}/follow`, followService, 'unfollow', 200],
    ['get', `/api/users/${P}/followers`, followService, 'listFollowers', 200],
    ['get', `/api/users/${P}/following`, followService, 'listFollowing', 200],
    ['get', '/api/users/mention-search?q=as', followService, 'mentionSearch', 200],
    ['post', `/api/posts/${P}/report`, reportService, 'report', 201],
    ['post', `/api/comments/${P}/report`, reportService, 'report', 201],
  ] as const)('%s %s → %s.%s with the member as viewer (%i)', async (method, url, service, fn, status) => {
    const { header, user } = authAs('MEMBER');
    const spy = jest.spyOn(service as any, fn).mockResolvedValue({ ok: true });

    const res = await (api() as any)[method](url).set('Authorization', header).send({ type: 'LIKE', content: 'hi', reason: 'SPAM' });

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ success: true, data: { ok: true } });
    expect(spy.mock.calls[0][0]).toMatchObject({ id: user.id });
  });

  it('passes route params, bodies and queries through', async () => {
    const { header } = authAs('MEMBER');
    const react = jest.spyOn(reactionService, 'reactToPost').mockResolvedValue({} as any);
    const report = jest.spyOn(reportService, 'report').mockResolvedValue({} as any);
    const feed = jest.spyOn(feedService, 'getFeed').mockResolvedValue(page as any);
    const mention = jest.spyOn(followService, 'mentionSearch').mockResolvedValue([]);

    await api().post(`/api/posts/${P}/react`).set('Authorization', header).send({ type: 'LOVE' });
    await api().post(`/api/comments/${P}/report`).set('Authorization', header).send({ reason: 'SPAM', details: 'x' });
    await api().get('/api/feed?tab=latest&cursor=abc').set('Authorization', header);
    await api().get('/api/users/mention-search?q=asha&limit=3').set('Authorization', header);

    expect(react.mock.calls[0].slice(1)).toEqual([P, 'LOVE']);
    expect(report.mock.calls[0].slice(1)).toEqual([{ kind: 'comment', id: P }, { reason: 'SPAM', details: 'x' }]);
    expect(feed.mock.calls[0][1]).toMatchObject({ tab: 'latest', cursor: 'abc' });
    expect(mention.mock.calls[0].slice(1)).toEqual(['asha', '3']);
  });

  it.each([
    ['/api/hashtags/trending?days=3', hashtagService, 'getTrending'],
    ['/api/hashtags/placements/posts', feedService, 'getHashtagPosts'],
    [`/api/users/${P}/posts?reels=true`, feedService, 'getUserPosts'],
    [`/api/posts/${P}/comments?sort=newest`, postService, 'listComments'],
    [`/api/comments/${P}/replies`, postService, 'listReplies'],
  ] as const)('GET %s works anonymously', async (url, service, fn) => {
    const spy = jest.spyOn(service as any, fn).mockResolvedValue(page);
    const res = await api().get(url);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(page);
    expect(spy).toHaveBeenCalled();
  });

  it('POST /api/posts/:id/view counts for members and accepts anonymous calls', async () => {
    const spy = jest.spyOn(postService, 'recordView').mockResolvedValue({ views: 3 });
    const anon = await api().post(`/api/posts/${P}/view`);
    expect(anon.status).toBe(200);
    expect(spy.mock.calls[0]).toEqual([P, undefined]);

    const { header, user } = authAs('MEMBER');
    await api().post(`/api/posts/${P}/view`).set('Authorization', header);
    expect(spy.mock.calls[1][1]).toMatchObject({ id: user.id });
  });

  it('forwards service errors with their status', async () => {
    const { header } = authAs('MEMBER');
    jest.spyOn(repostService, 'repost').mockRejectedValue(new AppError('You already reposted this post', 409, 'ALREADY_REPOSTED'));
    const res = await api().post(`/api/posts/${P}/repost`).set('Authorization', header);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_REPOSTED');
  });

  describe('admin reports', () => {
    it('lists and resolves reports for admins', async () => {
      const { header, user } = authAs('ADMIN');
      const list = jest.spyOn(reportService, 'list').mockResolvedValue(page as any);
      const resolve = jest.spyOn(reportService, 'resolve').mockResolvedValue({ id: P, status: 'RESOLVED', reportsClosed: 1 });

      expect((await api().get('/api/admin/reports?status=OPEN').set('Authorization', header)).status).toBe(200);
      const res = await api().patch(`/api/admin/reports/${P}`).set('Authorization', header).send({ action: 'REMOVE_CONTENT' });

      expect(res.status).toBe(200);
      expect(list.mock.calls[0][1]).toMatchObject({ status: 'OPEN' });
      expect(resolve.mock.calls[0]).toEqual([expect.objectContaining({ id: user.id }), P, { action: 'REMOVE_CONTENT' }]);
    });

    it('forbids members', async () => {
      const { header } = authAs('MEMBER');
      expect((await api().get('/api/admin/reports').set('Authorization', header)).status).toBe(403);
    });
  });

  describe('POST /api/posts/video', () => {
    const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(32)]);
    let cwd: string;
    let cwdSpy: jest.SpyInstance;

    beforeEach(() => {
      cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'aitd-video-route-'));
      cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
    });

    afterEach(() => {
      cwdSpy.mockRestore();
      fs.rmSync(cwd, { recursive: true, force: true });
    });

    it('stores a real MP4 and returns 201 with its URL', async () => {
      const { header } = authAs('MEMBER');
      const res = await api().post('/api/posts/video').set('Authorization', header).attach('video', MP4, { filename: 'clip.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ mimeType: 'video/mp4', size: MP4.length });
      expect(fs.existsSync(path.join(cwd, res.body.data.url))).toBe(true);
    });

    it('rejects a fake video by its content and a non-video by its type', async () => {
      const { header } = authAs('MEMBER');
      const fake = await api()
        .post('/api/posts/video')
        .set('Authorization', header)
        .attach('video', Buffer.from('definitely not a video'), { filename: 'clip.mp4', contentType: 'video/mp4' });
      expect(fake.status).toBe(400);
      expect(fake.body.error.code).toBe('INVALID_FILE_TYPE');

      const image = await api()
        .post('/api/posts/video')
        .set('Authorization', header)
        .attach('video', Buffer.from([0xff, 0xd8, 0xff]), { filename: 'photo.jpg', contentType: 'image/jpeg' });
      expect(image.status).toBe(400);
    });

    it('400s without a file', async () => {
      const { header } = authAs('MEMBER');
      const res = await api().post('/api/posts/video').set('Authorization', header);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FILE');
    });

    it('forwards storage failures', async () => {
      const { header } = authAs('MEMBER');
      jest.spyOn(storage, 'storeVideo').mockRejectedValue(new Error('disk full'));
      const res = await api().post('/api/posts/video').set('Authorization', header).attach('video', MP4, { filename: 'clip.mp4', contentType: 'video/mp4' });
      expect(res.status).toBe(500);
    });
  });
});
