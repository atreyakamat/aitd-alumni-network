import {
  searchController,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_RESULTS_PER_TYPE,
} from '../../controllers/searchController';
import { api, authAs, mockReqRes, prismaMock } from '../../../tests/helpers';

const EMPTY = { users: [], jobs: [], events: [], posts: [] };

const arrangeResults = () => {
  prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', fullName: 'Test User' }]);
  prismaMock.jobOpportunity.findMany.mockResolvedValue([{ id: 'j1' }]);
  prismaMock.event.findMany.mockResolvedValue([{ id: 'e1' }]);
  prismaMock.post.findMany.mockResolvedValue([{ id: 'p1' }]);
};

const run = async (q: unknown) => {
  const ctx = mockReqRes({ query: q === undefined ? {} : { q } });
  await searchController.globalSearch(ctx.req, ctx.res, ctx.next);
  return ctx;
};

describe('searchController.globalSearch', () => {
  it.each([[undefined], [''], ['a'], ['  a  '], [['ab', 'cd']], [{ $gt: '' }]])(
    'returns empty results without querying for %j',
    async (q) => {
      const { res } = await run(q);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: EMPTY });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
      expect(prismaMock.post.findMany).not.toHaveBeenCalled();
    }
  );

  it('searches every entity and returns the combined results', async () => {
    arrangeResults();
    const { res, next } = await run('test');

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        users: [{ id: 'u1', fullName: 'Test User' }],
        jobs: [{ id: 'j1' }],
        events: [{ id: 'e1' }],
        posts: [{ id: 'p1' }],
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('limits every result set', async () => {
    arrangeResults();
    await run('test');
    for (const model of ['user', 'jobOpportunity', 'event', 'post']) {
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

  it('only returns PUBLISHED, public, upcoming events', async () => {
    arrangeResults();
    const before = Date.now();
    await run('meetup');
    const { where } = prismaMock.event.findMany.mock.calls[0][0];
    expect(where.status).toBe('PUBLISHED');
    expect(where.isPublic).toBe(true);
    expect(where.startDate.gte.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('only returns published posts by active authors, exposing minimal author info', async () => {
    arrangeResults();
    await run('hello');
    const args = prismaMock.post.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ content: { contains: 'hello', mode: 'insensitive' }, isPublished: true, user: { isActive: true } });
    expect(args.include.user.select).toEqual({ id: true, fullName: true, profilePhotoUrl: true });
  });

  it('forwards database errors to next()', async () => {
    const error = new Error('db down');
    prismaMock.user.findMany.mockRejectedValue(error);
    prismaMock.jobOpportunity.findMany.mockResolvedValue([]);
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.post.findMany.mockResolvedValue([]);

    const { next, res } = await run('test');

    expect(next).toHaveBeenCalledWith(error);
    expect(res.json).not.toHaveBeenCalled();
  });

  describe('GET /api/search (HTTP)', () => {
    it('requires authentication', async () => {
      const res = await api().get('/api/search?q=test');
      expect(res.status).toBe(401);
    });

    it('returns results for an authenticated member', async () => {
      const { header } = authAs('MEMBER');
      prismaMock.user.findMany.mockResolvedValue([]);
      prismaMock.jobOpportunity.findMany.mockResolvedValue([]);
      prismaMock.event.findMany.mockResolvedValue([]);
      prismaMock.post.findMany.mockResolvedValue([]);

      const res = await api().get('/api/search?q=test').set('Authorization', header);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, data: EMPTY });
    });
  });
});
