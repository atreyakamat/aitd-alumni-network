import {
  searchController,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_RESULTS_PER_TYPE,
} from '../../controllers/searchController';
import { api, authAs, mockReqRes, prismaMock } from '../../../tests/helpers';

const EMPTY = { users: [], jobs: [], events: [], posts: [], news: [], chapters: [] };
const MEMBER = { id: 'viewer-1', userRole: 'MEMBER' };

const arrangeResults = () => {
  prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'Test User' }]);
  prismaMock.jobOpportunity.findMany.mockResolvedValue([{ id: 'j1' }]);
  prismaMock.event.findMany.mockResolvedValue([{ id: 'e1' }]);
  prismaMock.post.findMany.mockResolvedValue([{ id: 'p1' }]);
  prismaMock.newsArticle.findMany.mockResolvedValue([{ id: 'n1' }]);
  prismaMock.chapter.findMany.mockResolvedValue([{ id: 'c1' }]);
};

/** Runs the handler as a signed-in member (default) or an anonymous visitor (`user: null`). */
const run = async (q: unknown, user: { id: string; userRole: string } | null = MEMBER) => {
  const ctx = mockReqRes({ query: q === undefined ? {} : { q }, ...(user ? { user } : {}) });
  await searchController.globalSearch(ctx.req, ctx.res, ctx.next);
  return ctx;
};

describe('searchController.globalSearch', () => {
  it.each([[undefined], [''], ['a'], ['  a  '], [['ab', 'cd']], [{ $gt: '' }]])(
    'returns empty results without querying for %j',
    async (q) => {
      const { res } = await run(q);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { scope: 'member', ...EMPTY } });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
      expect(prismaMock.post.findMany).not.toHaveBeenCalled();
    }
  );

  it('searches every entity for a member and returns the combined results', async () => {
    arrangeResults();
    const { res, next } = await run('test');

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        scope: 'member',
        users: [{ id: 'u1', fullName: 'Test User' }],
        jobs: [{ id: 'j1' }],
        events: [{ id: 'e1' }],
        posts: [{ id: 'p1' }],
        news: [{ id: 'n1' }],
        chapters: [{ id: 'c1' }],
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('limits every result set', async () => {
    arrangeResults();
    await run('test');
    for (const model of ['user', 'jobOpportunity', 'event', 'post', 'newsArticle', 'chapter']) {
      expect(prismaMock[model].findMany.mock.calls[0][0].take).toBe(SEARCH_RESULTS_PER_TYPE);
    }
  });

  it('trims and caps the query length', async () => {
    arrangeResults();
    const long = `  ${'x'.repeat(SEARCH_MAX_QUERY_LENGTH + 50)}  `;
    await run(long);
    const { where } = prismaMock.user.findMany.mock.calls[0][0];
    expect(where.OR[0].fullName.contains).toBe('x'.repeat(SEARCH_MAX_QUERY_LENGTH));
  });

  it('only returns active, verified users and never selects private fields', async () => {
    arrangeResults();
    await run('ann');

    const { where, select } = prismaMock.user.findMany.mock.calls[0][0];
    expect(where.isActive).toBe(true);
    expect(where.isVerified).toBe(true);
    expect(where.OR).toEqual([
      { fullName: { contains: 'ann', mode: 'insensitive' } },
      { currentDesignation: { contains: 'ann', mode: 'insensitive' } },
      { department: { contains: 'ann', mode: 'insensitive' } },
      { skills: { some: { skill: { name: { contains: 'ann', mode: 'insensitive' } } } } },
    ]);
    for (const field of ['email', 'secondaryEmail', 'phoneNumber', 'locationLat', 'locationLng', 'passwordHash']) {
      expect(select[field]).toBeUndefined();
    }
  });

  it('only returns PUBLISHED jobs', async () => {
    arrangeResults();
    await run('engineer');
    const args = prismaMock.jobOpportunity.findMany.mock.calls[0][0];
    expect(args.where.status).toBe('PUBLISHED');
    expect(args.select.postedById).toBeUndefined();
  });

  it('members also find upcoming members-only events; only published ones', async () => {
    arrangeResults();
    const before = Date.now();
    await run('meetup');
    const { where } = prismaMock.event.findMany.mock.calls[0][0];
    expect(where.status).toBe('PUBLISHED');
    expect(where.isPublic).toBeUndefined();
    expect(where.startDate.gte.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('applies the post visibility rules: published, active authors, and CONNECTIONS-only posts only to connections', async () => {
    arrangeResults();
    prismaMock.connection.findMany.mockResolvedValue([{ requesterId: 'viewer-1', addresseeId: 'friend-1' }]);
    await run('hello');
    const args = prismaMock.post.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      AND: [
        {
          isPublished: true,
          user: { isActive: true },
          OR: [{ visibility: 'PUBLIC' }, { userId: 'viewer-1' }, { userId: { in: ['friend-1'] } }],
        },
        { content: { contains: 'hello', mode: 'insensitive' } },
      ],
    });
    expect(args.include.user.select).toEqual({ id: true, fullName: true, profilePhotoUrl: true });
  });

  it('only returns published news and active chapters', async () => {
    arrangeResults();
    await run('campus');
    const news = prismaMock.newsArticle.findMany.mock.calls[0][0];
    expect(news.where.status).toBe('PUBLISHED');
    expect(news.where.OR.map((c: any) => Object.keys(c)[0])).toEqual(['title', 'excerpt', 'content']);
    expect(news.select.content).toBeUndefined(); // search results never carry full article bodies
    expect(prismaMock.chapter.findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  describe('anonymous visitors', () => {
    it('get only what is public (events, news, chapters) and are told the scope', async () => {
      arrangeResults();
      const { res } = await run('test', null);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { scope: 'public', ...EMPTY, events: [{ id: 'e1' }], news: [{ id: 'n1' }], chapters: [{ id: 'c1' }] },
      });
    });

    it('never touch members-only tables (people, jobs, posts)', async () => {
      arrangeResults();
      await run('test', null);
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
      expect(prismaMock.jobOpportunity.findMany).not.toHaveBeenCalled();
      expect(prismaMock.post.findMany).not.toHaveBeenCalled();
    });

    it('only see public, published, upcoming events', async () => {
      arrangeResults();
      await run('meetup', null);
      const { where } = prismaMock.event.findMany.mock.calls[0][0];
      expect(where.status).toBe('PUBLISHED');
      expect(where.isPublic).toBe(true);
    });

    it('get the public scope even for a too-short query', async () => {
      const { res } = await run('a', null);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { scope: 'public', ...EMPTY } });
    });
  });

  it('forwards database errors to next()', async () => {
    const error = new Error('db down');
    prismaMock.user.findMany.mockRejectedValue(error);
    prismaMock.jobOpportunity.findMany.mockResolvedValue([]);
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.newsArticle.findMany.mockResolvedValue([]);
    prismaMock.chapter.findMany.mockResolvedValue([]);

    const { next, res } = await run('test');

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });

  describe('GET /api/search (HTTP)', () => {
    const emptyAll = () => {
      for (const model of ['user', 'jobOpportunity', 'event', 'post', 'newsArticle', 'chapter']) {
        prismaMock[model].findMany.mockResolvedValue([]);
      }
    };

    it('works without signing in, with public results only', async () => {
      emptyAll();
      const res = await api().get('/api/search?q=test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { scope: 'public', ...EMPTY } });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    });

    it('rejects a bad token instead of silently downgrading to anonymous', async () => {
      const res = await api().get('/api/search?q=test').set('Authorization', 'Bearer not-a-token');
      expect(res.status).toBe(401);
    });

    it('returns full results for an authenticated member', async () => {
      const { header } = authAs('MEMBER');
      emptyAll();

      const res = await api().get('/api/search?q=test').set('Authorization', header);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: { scope: 'member', ...EMPTY } });
    });
  });
});
