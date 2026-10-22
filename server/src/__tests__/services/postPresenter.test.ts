import { isDeadPlainRepost, presentComments, presentPosts } from '../../services/postPresenter';
import { prismaMock } from '../../../tests/helpers';
import { commentRow, OTHER, OWNER, postRow } from '../../../tests/helpers/social';

const ctx = (id = OTHER, overrides: Record<string, unknown> = {}) => ({
  id,
  isAdmin: false,
  batchYear: 2015,
  connectionIds: new Set<string>(),
  followingIds: new Set<string>([OWNER]),
  ...overrides,
});

describe('presentPosts', () => {
  it('returns [] for an empty page without querying', async () => {
    await expect(presentPosts([], null)).resolves.toEqual([]);
    await expect(presentPosts(undefined as any, null)).resolves.toEqual([]);
    expect(prismaMock.postLike.groupBy).not.toHaveBeenCalled();
  });

  it('builds the full PostView with batched viewer state, summaries, tags and mentions', async () => {
    prismaMock.postLike.groupBy.mockResolvedValue([
      { postId: 'p1', type: 'LIKE', _count: { _all: 3 } },
      { postId: 'p1', type: 'CELEBRATE', _count: { _all: 1 } },
    ]);
    prismaMock.postLike.findMany.mockResolvedValue([{ postId: 'p1', type: 'LIKE' }]);
    prismaMock.savedPost.findMany.mockResolvedValue([{ postId: 'p1' }]);
    prismaMock.post.findMany.mockResolvedValue([{ repostOfId: 'p1' }]);
    prismaMock.postHashtag.findMany.mockResolvedValue([{ postId: 'p1', hashtag: { tag: 'alumni' } }]);
    prismaMock.postMention.findMany.mockResolvedValue([{ postId: 'p1', user: { id: 'm1', fullName: 'Mia' } }]);

    const [view] = await presentPosts(
      [postRow({ likeCount: 4, commentCount: 2, repostCount: 1, viewCount: 9, mediaUrls: ['/a.jpg', 5] })],
      ctx()
    );

    expect(view).toMatchObject({
      id: 'p1',
      mediaUrls: ['/a.jpg'],
      counts: { reactions: 4, comments: 2, reposts: 1, views: 9 },
      reactionSummary: { LIKE: 3, CELEBRATE: 1 },
      topReactions: ['LIKE', 'CELEBRATE'],
      hashtags: ['alumni'],
      mentions: [{ id: 'm1', fullName: 'Mia' }],
      viewer: { reaction: 'LIKE', saved: true, reposted: true, isAuthor: false, followsAuthor: true },
      repostOf: null,
      reason: null,
      likeCount: 4,
      commentCount: 2,
      isLiked: true,
      _count: { likes: 4, comments: 2 },
    });
    expect(view.user).not.toHaveProperty('isActive');
    expect(prismaMock.post.findMany.mock.calls[0][0].where).toEqual({ plainRepostKey: { in: [`${OTHER}:p1`] } });
  });

  it('gives anonymous viewers neutral viewer state and skips their lookups', async () => {
    const [view] = await presentPosts([postRow({ mediaUrls: null, likeCount: undefined })], null);
    expect(view.viewer).toEqual({ reaction: null, saved: false, reposted: false, isAuthor: false, followsAuthor: false });
    expect(view.mediaUrls).toEqual([]);
    expect(view.counts.reactions).toBe(0);
    expect(prismaMock.savedPost.findMany).not.toHaveBeenCalled();
  });

  it('embeds the original of a repost (loaded in one query) and marks plain reposts with a reason', async () => {
    prismaMock.post.findMany.mockImplementation(async (args: any) =>
      args.where.id ? [postRow({ id: 'orig', userId: 'author' })] : []
    );

    const [plain, quote] = await presentPosts(
      [
        postRow({ id: 'r1', userId: OTHER, isRepost: true, repostOfId: 'orig', content: '' }),
        postRow({ id: 'q1', userId: OTHER, isRepost: true, repostOfId: 'orig', content: 'so true' }),
      ],
      ctx()
    );

    expect(prismaMock.post.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['orig'] } });
    expect(plain.repostOf).toMatchObject({ id: 'orig', repostOf: null });
    expect(plain.reason).toEqual({ type: 'REPOST', user: expect.objectContaining({ id: OTHER }) });
    expect(quote.reason).toBeNull();
    expect(isDeadPlainRepost(plain)).toBe(false);
  });

  it('shows an unavailable original when it was deleted or is hidden from the viewer', async () => {
    prismaMock.post.findMany.mockImplementation(async (args: any) =>
      args.where.id ? [postRow({ id: 'hidden', userId: 'author', visibility: 'CONNECTIONS' })] : undefined
    );

    const [gone, hidden] = await presentPosts(
      [
        postRow({ id: 'r1', isRepost: true, repostOfId: null, content: '' }),
        postRow({ id: 'r2', isRepost: true, repostOfId: 'hidden', content: '' }),
      ],
      ctx()
    );

    expect(gone.repostOf).toEqual({ id: '', unavailable: true });
    expect(hidden.repostOf).toEqual({ id: 'hidden', unavailable: true });
    expect(isDeadPlainRepost(gone)).toBe(true);
    expect(isDeadPlainRepost({ ...gone, repostOf: null })).toBe(true);
  });

  it('reuses an original that is already on the page', async () => {
    const views = await presentPosts(
      [postRow({ id: 'orig' }), postRow({ id: 'r1', isRepost: true, repostOfId: 'orig', content: '' })],
      null
    );
    expect(views[1].repostOf).toMatchObject({ id: 'orig' });
    expect(prismaMock.post.findMany).not.toHaveBeenCalled();
  });
});

describe('presentComments', () => {
  it('returns [] for no rows', async () => {
    await expect(presentComments([], null)).resolves.toEqual([]);
    await expect(presentComments(undefined as any, null)).resolves.toEqual([]);
  });

  it('presents comments with mentions, counts and the viewer’s reaction', async () => {
    prismaMock.commentReaction.findMany.mockResolvedValue([{ commentId: 'c1', type: 'FUNNY' }]);

    const [view] = await presentComments(
      [commentRow({ likeCount: 2, _count: { replies: 3 }, mentions: [{ user: { id: 'm1', fullName: 'Mia' } }] })],
      ctx(OTHER)
    );

    expect(view).toMatchObject({
      id: 'c1',
      likeCount: 2,
      replyCount: 3,
      mentions: [{ id: 'm1', fullName: 'Mia' }],
      viewer: { reaction: 'FUNNY', isAuthor: true },
    });
    expect(view).not.toHaveProperty('previewReplies');
  });

  it('handles missing optional data for anonymous viewers', async () => {
    const [view] = await presentComments(
      [commentRow({ parentId: 'c0', likeCount: undefined, mentions: undefined, _count: undefined, editedAt: undefined })],
      null
    );
    expect(view).toMatchObject({ replyCount: 0, likeCount: 0, mentions: [], editedAt: null, viewer: { reaction: null, isAuthor: false } });
    expect(prismaMock.commentReaction.findMany).not.toHaveBeenCalled();
  });

  it('tolerates a missing reaction lookup result', async () => {
    prismaMock.commentReaction.findMany.mockResolvedValue(undefined);
    const [view] = await presentComments([commentRow({ _count: undefined })], ctx());
    expect(view.replyCount).toBe(0);
    expect(view.viewer.reaction).toBeNull();
  });
});
