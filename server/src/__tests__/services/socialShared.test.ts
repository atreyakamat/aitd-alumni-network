import {
  canViewPost,
  encodeCursor,
  loadViewerContext,
  normalizeTag,
  pageResult,
  parseHashtags,
  parsePage,
  parseReaction,
  parseVisibility,
  resolveMentionIds,
  summarizeReactions,
  visiblePostWhere,
  MAX_HASHTAGS_PER_POST,
} from '../../services/socialShared';
import { prismaMock } from '../../../tests/helpers';

const ctx = (overrides: Partial<Parameters<typeof canViewPost>[1] & object> = {}) => ({
  id: 'me',
  isAdmin: false,
  batchYear: 2015,
  connectionIds: new Set(['friend']),
  followingIds: new Set<string>(),
  ...overrides,
});

describe('loadViewerContext', () => {
  it('collects connections in both directions, follows, batch and admin flag', async () => {
    prismaMock.connection.findMany.mockResolvedValue([
      { requesterId: 'me', addresseeId: 'a' },
      { requesterId: 'b', addresseeId: 'me' },
    ]);
    prismaMock.follow.findMany.mockResolvedValue([{ followingId: 'c' }]);
    prismaMock.user.findUnique.mockResolvedValue({ batchYear: 2012 });

    const result = await loadViewerContext({ id: 'me', userRole: 'ADMIN' });

    expect(prismaMock.connection.findMany.mock.calls[0][0].where).toEqual({
      status: 'ACCEPTED',
      OR: [{ requesterId: 'me' }, { addresseeId: 'me' }],
    });
    expect(result).toEqual({
      id: 'me',
      isAdmin: true,
      batchYear: 2012,
      connectionIds: new Set(['a', 'b']),
      followingIds: new Set(['c']),
    });
  });

  it('returns null for anonymous viewers and tolerates empty lookups', async () => {
    await expect(loadViewerContext(undefined)).resolves.toBeNull();
    await expect(loadViewerContext({ id: '' })).resolves.toBeNull();
    const result = await loadViewerContext({ id: 'me' });
    expect(result).toMatchObject({ isAdmin: false, batchYear: null });
    expect(result!.connectionIds.size).toBe(0);
  });
});

describe('visibility', () => {
  it('builds the where clause per viewer kind', () => {
    expect(visiblePostWhere(null)).toEqual({ isPublished: true, user: { isActive: true }, visibility: 'PUBLIC' });
    expect(visiblePostWhere(ctx({ isAdmin: true }))).toEqual({ isPublished: true, user: { isActive: true } });
    expect(visiblePostWhere(ctx())).toEqual({
      isPublished: true,
      user: { isActive: true },
      OR: [{ visibility: 'PUBLIC' }, { userId: 'me' }, { userId: { in: ['friend'] } }],
    });
  });

  it.each([
    ['public post, anonymous', { userId: 'x', visibility: 'PUBLIC', isPublished: true }, null, true],
    ['connections post, anonymous', { userId: 'x', visibility: 'CONNECTIONS', isPublished: true }, null, false],
    ['connections post, connected', { userId: 'friend', visibility: 'CONNECTIONS', isPublished: true }, ctx(), true],
    ['connections post, stranger', { userId: 'x', visibility: 'CONNECTIONS', isPublished: true }, ctx(), false],
    ['own unpublished post', { userId: 'me', visibility: 'PUBLIC', isPublished: false }, ctx(), true],
    ['unpublished post', { userId: 'x', visibility: 'PUBLIC', isPublished: false }, ctx(), false],
    ['admin sees anything', { userId: 'x', visibility: 'CONNECTIONS', isPublished: false }, ctx({ isAdmin: true }), true],
    ['deactivated author', { userId: 'x', visibility: 'PUBLIC', isPublished: true, user: { isActive: false } }, ctx(), false],
    ['missing post', null, ctx(), false],
  ])('canViewPost: %s', (_label, post, viewer, expected) => {
    expect(canViewPost(post as any, viewer as any)).toBe(expected);
  });
});

describe('cursor pagination', () => {
  const now = new Date('2026-10-19T00:00:00Z');

  it('starts at offset 0 with the default page size and clamps limits', () => {
    expect(parsePage(undefined, undefined, now)).toEqual({ snapshot: now, offset: 0, limit: 20 });
    expect(parsePage('', '500', now).limit).toBe(50);
    expect(parsePage(null, 5, now).limit).toBe(5);
    expect(parsePage(undefined, '-3', now).limit).toBe(20);
  });

  it('round-trips a cursor', () => {
    const cursor = encodeCursor(now, 40);
    expect(parsePage(cursor, '10')).toEqual({ snapshot: now, offset: 40, limit: 10 });
  });

  it.each([
    ['garbage', 'not-base64-json'],
    ['non-string', 42],
    ['too long', 'x'.repeat(201)],
    ['bad date', Buffer.from(JSON.stringify({ t: 'nope', o: 0 })).toString('base64url')],
    ['negative offset', Buffer.from(JSON.stringify({ t: now.toISOString(), o: -1 })).toString('base64url')],
    ['huge offset', Buffer.from(JSON.stringify({ t: now.toISOString(), o: 1e9 })).toString('base64url')],
  ])('rejects a %s cursor with 400 INVALID_CURSOR', (_label, cursor) => {
    expect(() => parsePage(cursor, undefined)).toThrow(expect.objectContaining({ statusCode: 400, code: 'INVALID_CURSOR' }));
  });

  it('trims the probe row and only issues a next cursor when more rows exist', () => {
    const page = { snapshot: now, offset: 20, limit: 2 };
    expect(pageResult([1, 2, 3], page)).toEqual({ items: [1, 2], nextCursor: encodeCursor(now, 22) });
    expect(pageResult([1, 2], page)).toEqual({ items: [1, 2], nextCursor: null });
  });
});

describe('hashtags', () => {
  it('extracts lower-cased, unique tags that contain a letter', () => {
    expect(parseHashtags('Hiring at #Acme! #acme #Batch2015, #2015 #a_b')).toEqual(['acme', 'batch2015', 'a_b']);
  });

  it('ignores anchors, entities, mid-word hashes and non-strings', () => {
    expect(parseHashtags('see https://x.com/#section and &#39; and C#sharp ##double')).toEqual([]);
    expect(parseHashtags(42)).toEqual([]);
    expect(parseHashtags('no tags here')).toEqual([]);
  });

  it('caps tags per post', () => {
    const content = Array.from({ length: 40 }, (_, i) => `#tag${i}`).join(' ');
    expect(parseHashtags(content)).toHaveLength(MAX_HASHTAGS_PER_POST);
  });

  it('normalizes tags from URLs', () => {
    expect(normalizeTag('#Placements')).toBe('placements');
    expect(normalizeTag(' batch_2015 ')).toBe('batch_2015');
    expect(normalizeTag('2015')).toBeNull();
    expect(normalizeTag('bad tag')).toBeNull();
    expect(normalizeTag(undefined)).toBeNull();
  });
});

describe('mentions', () => {
  it('keeps active, existing members and never the author', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }]);
    await expect(resolveMentionIds([' a ', 'a', 'ghost', 'author'], 'author')).resolves.toEqual(['a']);
  });

  it('skips the lookup when nothing is left and tolerates an empty result', async () => {
    await expect(resolveMentionIds(undefined, 'me')).resolves.toEqual([]);
    await expect(resolveMentionIds(['me'], 'me')).resolves.toEqual([]);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    prismaMock.user.findMany.mockResolvedValue(undefined);
    await expect(resolveMentionIds(['x'], 'me')).resolves.toEqual([]);
  });

  it('rejects malformed input', async () => {
    await expect(resolveMentionIds('a', 'me')).rejects.toMatchObject({ statusCode: 400 });
    await expect(resolveMentionIds([''], 'me')).rejects.toMatchObject({ statusCode: 400 });
    await expect(resolveMentionIds([1], 'me')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('enums and summaries', () => {
  it('parses reactions and visibility case-insensitively', () => {
    expect(parseReaction('celebrate')).toBe('CELEBRATE');
    expect(() => parseReaction('ANGRY')).toThrow(expect.objectContaining({ code: 'INVALID_REACTION' }));
    expect(() => parseReaction(undefined)).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(parseVisibility(undefined)).toBe('PUBLIC');
    expect(parseVisibility('connections')).toBe('CONNECTIONS');
    expect(() => parseVisibility(3)).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('summarizes reactions, ranking the top three (ties by catalogue order)', () => {
    expect(
      summarizeReactions([
        { type: 'FUNNY', count: 2 },
        { type: 'LIKE', count: 2 },
        { type: 'LOVE', count: 5 },
        { type: 'SUPPORT', count: 1 },
        { type: 'CELEBRATE', count: 0 },
      ])
    ).toEqual({ reactionSummary: { FUNNY: 2, LIKE: 2, LOVE: 5, SUPPORT: 1 }, topReactions: ['LOVE', 'LIKE', 'FUNNY'] });
  });
});
