import { describe, expect, it } from 'vitest';
import {
  activeMentionIds,
  applyCommentReaction,
  applyPostReaction,
  compactCount,
  extractHashtags,
  findMentionQuery,
  insertMention,
  isPlainRepost,
  isUnavailablePost,
  mergeReactionResponse,
  nextReaction,
  normalizeComment,
  normalizePage,
  normalizePost,
  normalizeReport,
  normalizeTrending,
  relativeTime,
  targetPost,
  tokenizeContent,
  topReactionsOf,
  validateVideoFile,
  type SocialPost,
} from '@/lib/social';
import { appendUnique } from '@/hooks/use-cursor-list';

const author = { id: 'u1', fullName: 'Asha Rao', profilePhotoUrl: null, currentDesignation: 'Engineer', batchYear: 2015 };

const v2Post = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  type: 'GENERAL',
  content: 'Hello #AITD',
  mediaUrls: ['/uploads/posts/a.jpg'],
  videoUrl: null,
  thumbnailUrl: null,
  isReel: false,
  isRepost: false,
  linkUrl: null,
  visibility: 'PUBLIC',
  isPinned: false,
  createdAt: '2026-10-19T10:00:00.000Z',
  updatedAt: '2026-10-19T10:00:00.000Z',
  editedAt: null,
  user: author,
  counts: { reactions: 3, comments: 2, reposts: 1, views: 9 },
  reactionSummary: { LIKE: 2, CELEBRATE: 1 },
  topReactions: ['LIKE', 'CELEBRATE'],
  hashtags: ['aitd'],
  mentions: [],
  viewer: { reaction: 'LIKE', saved: true, reposted: false, isAuthor: false, followsAuthor: true },
  repostOf: null,
  reason: null,
  ...overrides,
});

describe('normalizePost', () => {
  it('keeps a full v2 payload', () => {
    const post = normalizePost(v2Post());
    expect(post.counts).toEqual({ reactions: 3, comments: 2, reposts: 1, views: 9 });
    expect(post.viewer).toEqual({ reaction: 'LIKE', saved: true, reposted: false, isAuthor: false, followsAuthor: true });
    expect(post.topReactions).toEqual(['LIKE', 'CELEBRATE']);
    expect(post.user.batchYear).toBe(2015);
    expect(post.hashtags).toEqual(['aitd']);
  });

  it('falls back to v1 fields (likeCount, _count, isLiked) and attributes reactions to LIKE', () => {
    const post = normalizePost({
      id: 'old',
      content: 'v1 post',
      likeCount: 4,
      _count: { likes: 4, comments: 7 },
      isLiked: true,
      user: { id: 'u2', fullName: 'Old Timer' },
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(post.counts).toEqual({ reactions: 4, comments: 7, reposts: 0, views: 0 });
    expect(post.viewer.reaction).toBe('LIKE');
    expect(post.reactionSummary).toEqual({ LIKE: 4 });
    expect(post.mediaUrls).toEqual([]);
    expect(post.visibility).toBe('PUBLIC');
  });

  it('survives garbage: missing user, negative counts, bad enums, non-string media', () => {
    const post = normalizePost({ id: 'x', counts: { reactions: -5, comments: 'abc' }, visibility: 'SECRET', mediaUrls: [1, '', '/ok.png'], viewer: { reaction: 'ANGRY' } });
    expect(post.user.fullName).toBe('Alumni member');
    expect(post.counts.reactions).toBe(0);
    expect(post.counts.comments).toBe(0);
    expect(post.visibility).toBe('PUBLIC');
    expect(post.mediaUrls).toEqual(['/ok.png']);
    expect(post.viewer.reaction).toBeNull();
    expect(normalizePost(null).id).toBe('');
  });

  it('normalises the reposted original one level deep and marks deleted originals unavailable', () => {
    const quote = normalizePost(v2Post({ id: 'q', isRepost: true, content: 'So proud!', repostOf: v2Post({ id: 'orig', repostOf: v2Post({ id: 'deeper' }) }) }));
    expect(quote.isRepost).toBe(true);
    expect(isUnavailablePost(quote.repostOf)).toBe(false);
    const original = quote.repostOf as SocialPost;
    expect(original.id).toBe('orig');
    expect(isUnavailablePost(original.repostOf)).toBe(true);

    const gone = normalizePost(v2Post({ id: 'q2', isRepost: true, repostOf: { id: 'orig', unavailable: true } }));
    expect(gone.repostOf).toEqual({ id: 'orig', unavailable: true });

    const orphan = normalizePost(v2Post({ id: 'q3', isRepost: true, repostOf: null, repostOfId: 'dead' }));
    expect(orphan.repostOf).toEqual({ id: 'dead', unavailable: true });
  });
});

describe('plain reposts', () => {
  it('targets the original for interactions', () => {
    const plain = normalizePost(v2Post({ id: 'r', isRepost: true, content: '', mediaUrls: [], repostOf: v2Post({ id: 'orig' }) }));
    expect(isPlainRepost(plain)).toBe(true);
    expect(targetPost(plain).id).toBe('orig');
    const quote = normalizePost(v2Post({ id: 'q', isRepost: true, content: 'Nice', repostOf: v2Post({ id: 'orig' }) }));
    expect(isPlainRepost(quote)).toBe(false);
    expect(targetPost(quote).id).toBe('q');
  });
});

describe('normalizeComment', () => {
  it('maps previewReplies and v1 replies', () => {
    const c = normalizeComment({
      id: 'c1',
      postId: 'p1',
      content: 'hi',
      user: author,
      likeCount: 2,
      replyCount: 5,
      viewer: { reaction: 'LOVE', isAuthor: true },
      previewReplies: [{ id: 'r1', parentId: 'c1', content: 'yo', user: author }],
    });
    expect(c.replyCount).toBe(5);
    expect(c.viewer).toEqual({ reaction: 'LOVE', isAuthor: true });
    expect(c.previewReplies.map((r) => r.id)).toEqual(['r1']);
    const legacy = normalizeComment({ id: 'c2', content: 'old', replies: [{ id: 'r2' }, { id: 'r3' }] });
    expect(legacy.replyCount).toBe(2);
    expect(legacy.previewReplies).toHaveLength(2);
  });
});

describe('normalizePage', () => {
  it('accepts items/nextCursor, bare arrays and v1 data pages', () => {
    expect(normalizePage({ items: [{ id: 'a' }], nextCursor: 'n' }, (x: any) => x.id)).toEqual({ items: ['a'], nextCursor: 'n' });
    expect(normalizePage([{ id: 'b' }], (x: any) => x.id)).toEqual({ items: ['b'], nextCursor: null });
    expect(normalizePage({ data: [{ id: 'c' }], pagination: {} }, (x: any) => x.id)).toEqual({ items: ['c'], nextCursor: null });
    expect(normalizePage(undefined, (x: any) => x)).toEqual({ items: [], nextCursor: null });
  });

  it('de-duplicates appended pages by id', () => {
    const merged = appendUnique([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }, { id: 'c' }], (x) => x.id);
    expect(merged.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('reactions', () => {
  it('nextReaction toggles the same type off and switches types', () => {
    expect(nextReaction(null, 'LIKE')).toBe('LIKE');
    expect(nextReaction('LIKE', 'LIKE')).toBeNull();
    expect(nextReaction('LIKE', 'LOVE')).toBe('LOVE');
  });

  it('applyPostReaction adds, switches and removes with correct counts', () => {
    const base = normalizePost(v2Post({ viewer: { reaction: null }, counts: { reactions: 3 }, reactionSummary: { LIKE: 2, CELEBRATE: 1 } }));
    const added = applyPostReaction(base, 'LOVE');
    expect(added.counts.reactions).toBe(4);
    expect(added.reactionSummary).toEqual({ LIKE: 2, CELEBRATE: 1, LOVE: 1 });
    const switched = applyPostReaction(added, 'CELEBRATE');
    expect(switched.counts.reactions).toBe(4);
    expect(switched.reactionSummary).toEqual({ LIKE: 2, CELEBRATE: 2 });
    expect(switched.topReactions).toEqual(['LIKE', 'CELEBRATE']);
    const removed = applyPostReaction(switched, null);
    expect(removed.counts.reactions).toBe(3);
    expect(removed.reactionSummary).toEqual({ LIKE: 2, CELEBRATE: 1 });
    expect(applyPostReaction(removed, null)).toBe(removed);
  });

  it('never goes negative', () => {
    const odd = normalizePost(v2Post({ viewer: { reaction: 'LIKE' }, counts: { reactions: 0 }, reactionSummary: {} }));
    expect(applyPostReaction(odd, null).counts.reactions).toBe(0);
  });

  it('applyCommentReaction adjusts likeCount', () => {
    const c = normalizeComment({ id: 'c', likeCount: 1, viewer: { reaction: null } });
    expect(applyCommentReaction(c, 'LIKE').likeCount).toBe(2);
    expect(applyCommentReaction(applyCommentReaction(c, 'LIKE'), 'FUNNY').likeCount).toBe(2);
    expect(applyCommentReaction(applyCommentReaction(c, 'LIKE'), null).likeCount).toBe(1);
  });

  it('mergeReactionResponse prefers server numbers, including the v1 like shape', () => {
    const base = normalizePost(v2Post());
    const merged = mergeReactionResponse(base, { reaction: 'FUNNY', counts: { reactions: 10 }, reactionSummary: { FUNNY: 6, LIKE: 4 } });
    expect(merged.viewer.reaction).toBe('FUNNY');
    expect(merged.counts.reactions).toBe(10);
    expect(merged.topReactions).toEqual(['FUNNY', 'LIKE']);
    const v1 = mergeReactionResponse(base, { liked: false, likeCount: 2, reaction: null });
    expect(v1.viewer.reaction).toBeNull();
    expect(v1.counts.reactions).toBe(2);
  });

  it('topReactionsOf orders by count, max 3', () => {
    expect(topReactionsOf({ LIKE: 1, LOVE: 5, FUNNY: 3, SUPPORT: 2 })).toEqual(['LOVE', 'FUNNY', 'SUPPORT']);
    expect(topReactionsOf({})).toEqual([]);
  });
});

describe('tokenizeContent', () => {
  const mentions = [
    { id: 'u1', fullName: 'Asha Rao' },
    { id: 'u2', fullName: 'Asha' },
  ];

  it('splits hashtags, mentions and urls, keeping the rest as text', () => {
    const tokens = tokenizeContent('Congrats @Asha Rao on #Placement2026! See https://aitd.edu/news.', mentions);
    expect(tokens).toEqual([
      { kind: 'text', value: 'Congrats ' },
      { kind: 'mention', value: '@Asha Rao', userId: 'u1', href: '/profile/u1' },
      { kind: 'text', value: ' on ' },
      { kind: 'hashtag', value: '#Placement2026', tag: 'placement2026', href: '/hashtags/placement2026' },
      { kind: 'text', value: '! See ' },
      { kind: 'url', value: 'https://aitd.edu/news', href: 'https://aitd.edu/news' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('prefers the longest mention name and ignores @names the server did not list', () => {
    const tokens = tokenizeContent('@Asha Rao and @Asha and @Someone', mentions);
    expect(tokens.filter((t) => t.kind === 'mention').map((t) => (t as any).userId)).toEqual(['u1', 'u2']);
    expect(tokens.at(-1)).toEqual({ kind: 'text', value: ' and @Someone' });
  });

  it('does not treat mid-word # or url fragments as hashtags', () => {
    const tokens = tokenizeContent('C#sharp and https://x.io/#anchor and #ok', []);
    expect(tokens.filter((t) => t.kind === 'hashtag').map((t) => (t as any).tag)).toEqual(['ok']);
    expect(tokens.find((t) => t.kind === 'url')).toMatchObject({ value: 'https://x.io/#anchor' });
  });

  it('never produces executable markup and handles empty input', () => {
    expect(tokenizeContent('')).toEqual([]);
    expect(tokenizeContent('<script>alert(1)</script>')).toEqual([{ kind: 'text', value: '<script>alert(1)</script>' }]);
    expect(tokenizeContent('javascript:alert(1)').every((t) => t.kind === 'text')).toBe(true);
  });

  it('extractHashtags lower-cases and de-duplicates', () => {
    expect(extractHashtags('#AITD rocks #aitd #Batch_2015')).toEqual(['aitd', 'batch_2015']);
  });
});

describe('mention editing helpers', () => {
  it('finds the @query at the caret only when it starts a word', () => {
    expect(findMentionQuery('Hi @as', 6)).toEqual({ query: 'as', start: 3 });
    expect(findMentionQuery('@', 1)).toEqual({ query: '', start: 0 });
    expect(findMentionQuery('mail@x', 6)).toBeNull();
    expect(findMentionQuery('Hi @asha rao', 12)).toBeNull();
  });

  it('inserts the full name and reports active mention ids', () => {
    const { text, caret } = insertMention('Hi @as!', 3, 6, 'Asha Rao');
    expect(text).toBe('Hi @Asha Rao !');
    expect(caret).toBe(13);
    expect(activeMentionIds(text, [{ id: 'u1', fullName: 'Asha Rao' }, { id: 'u9', fullName: 'Gone Person' }])).toEqual(['u1']);
  });
});

describe('formatting', () => {
  it('compactCount', () => {
    expect(compactCount(0)).toBe('0');
    expect(compactCount(999)).toBe('999');
    expect(compactCount(1200)).toBe('1.2k');
    expect(compactCount(1000)).toBe('1k');
    expect(compactCount(15_400)).toBe('15k');
    expect(compactCount(2_500_000)).toBe('2.5M');
    expect(compactCount(Number.NaN)).toBe('0');
  });

  it('relativeTime', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(relativeTime('2026-10-19T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-10-19T11:55:00Z', now)).toBe('5m');
    expect(relativeTime('2026-10-19T09:00:00Z', now)).toBe('3h');
    expect(relativeTime('2026-10-17T12:00:00Z', now)).toBe('2d');
    expect(relativeTime('2026-10-01T12:00:00Z', now)).toBe('2w');
    expect(relativeTime('2026-08-03T12:00:00Z', now)).toBe('Aug 3');
    expect(relativeTime('2024-08-03T12:00:00Z', now)).toBe('Aug 3, 2024');
    expect(relativeTime('nope', now)).toBe('');
    expect(relativeTime(null, now)).toBe('');
  });

  it('validateVideoFile', () => {
    expect(validateVideoFile({ type: 'video/mp4', size: 1000 })).toBeNull();
    expect(validateVideoFile({ type: 'video/avi', size: 1000 })).toMatch(/MP4/);
    expect(validateVideoFile({ type: 'video/webm', size: 200 * 1024 * 1024 })).toMatch(/100 MB/);
  });
});

describe('misc normalisers', () => {
  it('normalizeTrending strips # and drops blanks', () => {
    expect(normalizeTrending([{ tag: '#AITD', postCount: 4 }, { tag: '' }, { postCount: 1 }])).toEqual([{ tag: 'aitd', postCount: 4 }]);
    expect(normalizeTrending({ items: [{ tag: 'x', postCount: '2' }] })).toEqual([{ tag: 'x', postCount: 2 }]);
  });

  it('normalizeReport defaults unknown enums and keeps a count of at least 1', () => {
    const r = normalizeReport({ id: 'r1', reason: 'WEIRD', status: 'OPEN', post: v2Post(), reporter: author });
    expect(r.reason).toBe('OTHER');
    expect(r.reportCount).toBe(1);
    expect(r.post?.id).toBe('p1');
    expect(r.comment).toBeNull();
  });
});
