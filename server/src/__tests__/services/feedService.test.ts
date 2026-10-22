import { feedService, scorePost, RANKING_CANDIDATES } from '../../services/feedService';
import { encodeCursor } from '../../services/socialShared';
import { prismaMock } from '../../../tests/helpers';
import { arrangeViewer, authorRow, OTHER, OWNER, postRow } from '../../../tests/helpers/social';

const VIEWER = 'viewer';
const NOW = new Date('2026-10-19T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const ctx = (overrides: Record<string, unknown> = {}) => ({
  id: VIEWER,
  isAdmin: false,
  batchYear: 2015,
  connectionIds: new Set<string>(),
  followingIds: new Set<string>(),
  ...overrides,
});

describe('scorePost', () => {
  it('rewards engagement and decays with age', () => {
    const fresh = scorePost(postRow({ createdAt: hoursAgo(1), userId: 'x', user: authorRow('x', { batchYear: 1999 }) }) as any, ctx(), NOW);
    const old = scorePost(postRow({ createdAt: hoursAgo(48), userId: 'x', user: authorRow('x', { batchYear: 1999 }) }) as any, ctx(), NOW);
    const busy = scorePost(
      postRow({ createdAt: hoursAgo(48), userId: 'x', likeCount: 10, commentCount: 5, repostCount: 2, viewCount: 100, user: authorRow('x', { batchYear: 1999 }) }) as any,
      ctx(),
      NOW
    );
    expect(fresh).toBeGreaterThan(old);
    // engagement = 10 + 2·5 + 3·2 + 0.05·100 = 31
    expect(busy / old).toBeCloseTo(32, 5);
  });

  it('boosts followed, connected and same-batch authors, but not the viewer’s own posts', () => {
    const row = postRow({ createdAt: hoursAgo(2), userId: 'a', user: authorRow('a', { batchYear: 2015 }) }) as any;
    const base = scorePost(row, null, NOW);
    expect(scorePost(row, ctx({ batchYear: 2000 }), NOW)).toBeCloseTo(base);
    expect(scorePost(row, ctx(), NOW) / base).toBeCloseTo(1.3);
    expect(scorePost(row, ctx({ followingIds: new Set(['a']), connectionIds: new Set(['a']) }), NOW) / base).toBeCloseTo(2.5);
    expect(scorePost({ ...row, userId: VIEWER }, ctx(), NOW) / base).toBeCloseTo(1);
    expect(scorePost({ ...row, likeCount: undefined, commentCount: undefined, repostCount: undefined, viewCount: undefined, user: undefined }, ctx({ batchYear: null }), NOW)).toBeCloseTo(base);
    // a clock skew (post "from the future") never yields a negative age
    expect(scorePost({ ...row, createdAt: new Date(NOW.getTime() + 3600_000) }, null, NOW)).toBeGreaterThan(base);
  });
});

describe('feedService.getFeed', () => {
  beforeEach(() => arrangeViewer(VIEWER, { connections: ['friend'], following: ['followed'] }));

  it('ranks for-you: pinned first, then by score; collapses plain reposts of the same original', async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    try {
      prismaMock.post.findMany.mockImplementation(async (args: any) => {
        if (args.where?.id) return [postRow({ id: 'orig', userId: 'author', createdAt: hoursAgo(30) })];
        return [
          postRow({ id: 'pinned', userId: 'admin', isPinned: true, createdAt: hoursAgo(200) }),
          postRow({ id: 'quiet', userId: 'x', createdAt: hoursAgo(1) }),
          postRow({ id: 'viral', userId: 'x', createdAt: hoursAgo(3), likeCount: 50 }),
          postRow({ id: 'r1', userId: 'friend', isRepost: true, repostOfId: 'orig', content: '', createdAt: hoursAgo(2) }),
          postRow({ id: 'r2', userId: 'followed', isRepost: true, repostOfId: 'orig', content: '', createdAt: hoursAgo(2.5) }),
        ];
      });

      const result = await feedService.getFeed({ id: VIEWER }, {});

      const args = prismaMock.post.findMany.mock.calls[0][0];
      expect(args.take).toBe(RANKING_CANDIDATES);
      expect(args.where.AND[1]).toEqual({ createdAt: { lte: NOW } });
      expect(result.items.map((p) => p.id)).toEqual(['pinned', 'viral', 'r1', 'quiet']);
      expect(result.items[2]).toMatchObject({ reason: { type: 'REPOST' }, repostOf: { id: 'orig' } });
      expect(result.nextCursor).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('pages the ranked list with a snapshot cursor', async () => {
    prismaMock.post.findMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => postRow({ id: `p${i}`, userId: 'x', createdAt: hoursAgo(i + 1) }))
    );
    const first = await feedService.getFeed({ id: VIEWER }, { tab: 'for-you', limit: '2' });
    expect(first.items.map((p) => p.id)).toEqual(['p0', 'p1']);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await feedService.getFeed({ id: VIEWER }, { limit: '2', cursor: first.nextCursor });
    expect(second.items.map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('breaks exact ties by recency then id, and hides plain reposts whose original is gone', async () => {
    const same = hoursAgo(5);
    prismaMock.post.findMany.mockImplementation(async (args: any) =>
      args.where?.id
        ? []
        : [
            postRow({ id: 'a', userId: 'x', createdAt: same }),
            postRow({ id: 'b', userId: 'x', createdAt: same }),
            postRow({ id: 'dead', userId: 'x', isRepost: true, repostOfId: 'deleted', content: '', createdAt: same }),
          ]
    );
    const result = await feedService.getFeed({ id: VIEWER }, { cursor: encodeCursor(NOW, 0) });
    expect(result.items.map((p) => p.id)).toEqual(['dead', 'b', 'a'].filter((id) => id !== 'dead'));
  });

  it('tolerates an empty candidate list', async () => {
    prismaMock.post.findMany.mockResolvedValue(undefined);
    await expect(feedService.getFeed({ id: VIEWER }, {})).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('following: the viewer, people they follow and connections, newest first', async () => {
    prismaMock.post.findMany.mockResolvedValue([postRow({ id: 'p1', userId: 'friend' })]);

    const result = await feedService.getFeed({ id: VIEWER }, { tab: 'following' });

    const args = prismaMock.post.findMany.mock.calls[0][0];
    expect(args.where.AND[2]).toEqual({ userId: { in: [VIEWER, 'followed', 'friend'] } });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(result.items.map((p) => p.id)).toEqual(['p1']);
  });

  it('latest: everything visible, newest first, collapsing duplicate stories on the page', async () => {
    prismaMock.post.findMany.mockResolvedValue([
      postRow({ id: 'orig' }),
      postRow({ id: 'r1', userId: OTHER, isRepost: true, repostOfId: 'orig', content: '' }),
    ]);
    const result = await feedService.getFeed({ id: VIEWER }, { tab: 'latest' });
    expect(prismaMock.post.findMany.mock.calls[0][0].where.AND[2]).toEqual({});
    expect(result.items.map((p) => p.id)).toEqual(['orig']);
  });

  it('rejects an unknown tab', async () => {
    await expect(feedService.getFeed({ id: VIEWER }, { tab: 'popular' })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TAB' });
  });
});

describe('feedService lists', () => {
  it('reels: ranked for members, newest first for visitors', async () => {
    arrangeViewer(VIEWER);
    prismaMock.post.findMany.mockResolvedValue([postRow({ id: 'reel', isReel: true, videoUrl: '/uploads/videos/v.mp4' })]);

    await feedService.getReels({ id: VIEWER }, {});
    expect(prismaMock.post.findMany.mock.calls[0][0]).toMatchObject({ take: RANKING_CANDIDATES });
    expect(prismaMock.post.findMany.mock.calls[0][0].where.AND[2]).toEqual({ isReel: true });

    prismaMock.post.findMany.mockClear();
    const anon = await feedService.getReels(undefined, { limit: '5' });
    expect(prismaMock.post.findMany.mock.calls[0][0]).toMatchObject({ take: 6, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    expect(anon.items[0]).toMatchObject({ id: 'reel', isReel: true });
  });

  it('hashtag posts filter by the normalized tag and reject invalid tags', async () => {
    prismaMock.post.findMany.mockResolvedValue([]);
    await feedService.getHashtagPosts('#Placements', null, {});
    expect(prismaMock.post.findMany.mock.calls[0][0].where.AND[2]).toEqual({ hashtags: { some: { hashtag: { tag: 'placements' } } } });
    await expect(feedService.getHashtagPosts('bad tag', null, {})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('user posts: optionally reels only; 404 for unknown or deactivated members', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: OWNER, isActive: true });
    prismaMock.post.findMany.mockResolvedValue([]);
    await feedService.getUserPosts(OWNER, null, { reels: 'true' });
    expect(prismaMock.post.findMany.mock.calls[0][0].where.AND[2]).toEqual({ userId: OWNER, isReel: true });

    await feedService.getUserPosts(OWNER, null, {});
    expect(prismaMock.post.findMany.mock.calls[1][0].where.AND[2]).toEqual({ userId: OWNER });

    prismaMock.user.findUnique.mockResolvedValue({ id: OWNER, isActive: false });
    await expect(feedService.getUserPosts(OWNER, null, {})).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(feedService.getUserPosts(OWNER, null, {})).rejects.toMatchObject({ statusCode: 404 });
  });

  it('a deactivated member’s own posts stay visible to them and to admins', async () => {
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.connection.findMany.mockResolvedValue([]);
    prismaMock.follow.findMany.mockResolvedValue([]);
    prismaMock.user.findUnique.mockResolvedValue({ id: OWNER, isActive: false, batchYear: 2015 });
    await expect(feedService.getUserPosts(OWNER, { id: OWNER }, {})).resolves.toEqual({ items: [], nextCursor: null });
    await expect(feedService.getUserPosts(OWNER, { id: 'admin', userRole: 'ADMIN' }, {})).resolves.toBeDefined();
  });

  it('saved: newest saves first, dropping posts the viewer can no longer see', async () => {
    arrangeViewer(VIEWER);
    prismaMock.savedPost.findMany.mockResolvedValueOnce([
      { id: 's1', post: postRow({ id: 'keep' }) },
      { id: 's2', post: postRow({ id: 'hidden', visibility: 'CONNECTIONS' }) },
    ]);

    const result = await feedService.getSaved({ id: VIEWER }, {});

    expect(prismaMock.savedPost.findMany.mock.calls[0][0].where).toMatchObject({ userId: VIEWER });
    expect(result.items.map((p) => p.id)).toEqual(['keep']);

    prismaMock.savedPost.findMany.mockResolvedValueOnce(undefined);
    await expect(feedService.getSaved({ id: VIEWER }, {})).resolves.toEqual({ items: [], nextCursor: null });
  });

  it('toggleSave: saves, unsaves, tolerates a duplicate save and 404s for hidden posts', async () => {
    arrangeViewer(VIEWER);
    prismaMock.post.findUnique.mockResolvedValue(postRow());

    prismaMock.savedPost.deleteMany.mockResolvedValue({ count: 0 });
    await expect(feedService.toggleSave({ id: VIEWER }, 'p1')).resolves.toEqual({ saved: true });
    expect(prismaMock.savedPost.create).toHaveBeenCalledWith({ data: { userId: VIEWER, postId: 'p1' } });

    prismaMock.savedPost.deleteMany.mockResolvedValue({ count: 1 });
    await expect(feedService.toggleSave({ id: VIEWER }, 'p1')).resolves.toEqual({ saved: false });

    prismaMock.savedPost.deleteMany.mockResolvedValue(undefined);
    prismaMock.savedPost.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(feedService.toggleSave({ id: VIEWER }, 'p1')).resolves.toEqual({ saved: true });

    prismaMock.savedPost.create.mockRejectedValueOnce(new Error('db down'));
    await expect(feedService.toggleSave({ id: VIEWER }, 'p1')).rejects.toThrow('db down');

    prismaMock.post.findUnique.mockResolvedValue(null);
    await expect(feedService.toggleSave({ id: VIEWER }, 'p1')).rejects.toMatchObject({ statusCode: 404 });
  });
});
