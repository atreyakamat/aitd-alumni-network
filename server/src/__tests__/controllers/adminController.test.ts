import { api, authAs, getApp, mockReqRes, prismaMock } from '../../../tests/helpers';
import { adminController, growthPercent, toAmount } from '../../controllers/adminController';

const decimal = (n: number) => ({ toString: () => String(n), valueOf: () => n, toJSON: () => String(n) });

const arrangeEmptyDb = () => {
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.user.groupBy.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.post.count.mockResolvedValue(0);
  prismaMock.post.findMany.mockResolvedValue([]);
  prismaMock.postComment.count.mockResolvedValue(0);
  prismaMock.jobOpportunity.count.mockResolvedValue(0);
  prismaMock.event.count.mockResolvedValue(0);
  prismaMock.transaction.aggregate.mockResolvedValue({ _sum: { amount: null }, _count: 0 });
  prismaMock.userMembership.count.mockResolvedValue(0);
  prismaMock.connection.count.mockResolvedValue(0);
  prismaMock.message.count.mockResolvedValue(0);
};

const hasBadNumber = (value: unknown): boolean => {
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) return value.some(hasBadNumber);
  if (value && typeof value === 'object' && !(value instanceof Date)) return Object.values(value).some(hasBadNumber);
  return false;
};

describe('helpers', () => {
  it('growthPercent never divides by zero', () => {
    expect(growthPercent(0, 0)).toBe(0);
    expect(growthPercent(5, 0)).toBe(100);
    expect(growthPercent(15, 10)).toBe(50);
    expect(growthPercent(1, 3)).toBe(-66.7);
  });

  it('toAmount converts Decimal/null/garbage to finite numbers', () => {
    expect(toAmount(decimal(12.5))).toBe(12.5);
    expect(toAmount(null)).toBe(0);
    expect(toAmount(undefined)).toBe(0);
    expect(toAmount('abc')).toBe(0);
  });
});

describe('adminController.getStats', () => {
  it('handles an empty database without NaN or nulls', async () => {
    arrangeEmptyDb();
    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(hasBadNumber(body.data)).toBe(false);
    expect(body.data.users).toMatchObject({ total: 0, growthPercent: 0, pendingApproval: 0, rejected: 0, byRole: [], byBatch: [] });
    expect(body.data.users.monthlyGrowth).toHaveLength(12);
    expect(body.data.financial.donations).toMatchObject({ totalAmount: 0, totalCount: 0, thisMonth: 0, thisYear: 0 });
    expect(body.data.financial.donations.monthly).toHaveLength(12);
    expect(body.data.financial.donations.monthly[0]).toEqual({ month: expect.any(String), donations: 0, memberships: 0 });
    expect(body.data.recentActivity).toEqual({ users: [], posts: [] });
  });

  it('builds the full response shape with numeric amounts', async () => {
    arrangeEmptyDb();
    // Promise.all order: total, active, verified, newThisMonth, newLastMonth
    prismaMock.user.count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(40)
      .mockResolvedValueOnce(80)
      .mockResolvedValueOnce(15)
      .mockResolvedValueOnce(10);
    prismaMock.user.groupBy
      .mockResolvedValueOnce([{ userRole: 'MEMBER', _count: 90 }, { userRole: 'ADMIN', _count: { _all: 10 } }])
      .mockResolvedValueOnce([{ batchYear: 2020, _count: 30 }]);
    prismaMock.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: decimal(1500.5) }, _count: 3 })
      .mockResolvedValueOnce({ _sum: { amount: decimal(200) } })
      .mockResolvedValueOnce({ _sum: { amount: decimal(900) } });
    prismaMock.post.findMany.mockResolvedValue([
      { id: 'p1', content: 'x'.repeat(150), user: { fullName: 'A' }, likeCount: 2, commentCount: 1, createdAt: new Date() },
      { id: 'p2', content: 'short', user: null, likeCount: undefined, commentCount: undefined, createdAt: new Date() },
    ]);

    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const { data } = res.json.mock.calls[0][0];

    expect(data.users).toMatchObject({ total: 100, active: 40, verified: 80, newThisMonth: 15, growthPercent: 50 });
    expect(data.users.byRole).toEqual([
      { role: 'MEMBER', count: 90 },
      { role: 'ADMIN', count: 10 },
    ]);
    expect(data.users.byBatch).toEqual([{ year: 2020, count: 30 }]);
    expect(data.financial.donations).toMatchObject({ totalAmount: 1500.5, totalCount: 3, thisMonth: 200, thisYear: 900 });
    expect(typeof data.financial.donations.totalAmount).toBe('number');
    expect(data.recentActivity.posts[0].content).toBe(`${'x'.repeat(100)}...`);
    expect(data.recentActivity.posts[1]).toMatchObject({ content: 'short', author: null, likes: 0, comments: 0 });
    expect(Object.keys(data)).toEqual(['users', 'content', 'financial', 'engagement', 'recentActivity']);
  });

  it('only counts unexpired ACTIVE memberships as active', async () => {
    arrangeEmptyDb();
    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    const activeCall = prismaMock.userMembership.count.mock.calls.find((c: any[]) => c[0]?.where?.status === 'ACTIVE');
    expect(activeCall[0].where.OR[0]).toEqual({ endDate: null });
    expect(activeCall[0].where.OR[1].endDate.gte).toBeInstanceOf(Date);
  });

  it('only aggregates SUCCESS transactions', async () => {
    arrangeEmptyDb();
    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    for (const [args] of prismaMock.transaction.aggregate.mock.calls) {
      expect(args.where.status).toBe('SUCCESS');
    }
  });

  it('reports donation growth vs last month and new jobs/events this month', async () => {
    arrangeEmptyDb();
    // aggregate order: all-time, this month, this year, last month
    prismaMock.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: decimal(5000) }, _count: 5 })
      .mockResolvedValueOnce({ _sum: { amount: decimal(300) } })
      .mockResolvedValueOnce({ _sum: { amount: decimal(4000) } })
      .mockResolvedValueOnce({ _sum: { amount: decimal(200) } });
    prismaMock.jobOpportunity.count.mockImplementation((async (args: any) => (args?.where?.createdAt ? 4 : 9)) as any);
    prismaMock.event.count.mockImplementation((async (args: any) => (args?.where?.createdAt ? 2 : 6)) as any);

    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const { data } = res.json.mock.calls[0][0];
    expect(data.financial.donations).toMatchObject({ thisMonth: 300, lastMonth: 200, growthPercent: 50 });
    expect(data.content.jobs.newThisMonth).toBe(4);
    expect(data.content.events.newThisMonth).toBe(2);
    const lastMonthCall = prismaMock.transaction.aggregate.mock.calls[3][0];
    expect(lastMonthCall.where).toMatchObject({ status: 'SUCCESS', type: 'DONATION' });
    expect(lastMonthCall.where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('lists the top cities by alumni count, skipping blank cities', async () => {
    arrangeEmptyDb();
    prismaMock.user.groupBy
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ city: 'Pune', _count: { _all: 12 } }, { city: 'Goa', _count: 4 }]);
    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0][0].data.users.byLocation).toEqual([
      { city: 'Pune', count: 12 },
      { city: 'Goa', count: 4 },
    ]);
    const cityCall = prismaMock.user.groupBy.mock.calls.find((c: any[]) => c[0]?.by?.includes('city'));
    expect(cityCall[0]).toMatchObject({ where: { isActive: true, city: { not: null } }, take: 10 });
  });

  it('reports real comment counts instead of an approximation', async () => {
    arrangeEmptyDb();
    prismaMock.postComment.count.mockResolvedValueOnce(42).mockResolvedValueOnce(7);
    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const { data } = res.json.mock.calls[0][0];
    expect(data.content.comments).toEqual({ total: 42, thisMonth: 7 });
    const [, monthCall] = prismaMock.postComment.count.mock.calls;
    expect(monthCall[0].where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('returns a 7-day daily activity series counted per calendar day', async () => {
    arrangeEmptyDb();
    prismaMock.post.count.mockImplementation((async (args: any) => (args?.where?.createdAt?.lt ? 3 : 0)) as any);
    prismaMock.postComment.count.mockImplementation((async (args: any) => (args?.where?.createdAt?.lt ? 5 : 0)) as any);
    prismaMock.message.count.mockImplementation((async (args: any) => (args?.where?.createdAt?.lt ? 2 : 0)) as any);

    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    const daily = res.json.mock.calls[0][0].data.engagement.daily;

    expect(daily).toHaveLength(7);
    expect(daily[0]).toEqual({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), day: expect.any(String), posts: 3, comments: 5, messages: 2 });
    // Oldest first, ending today
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    expect(daily[6].date).toBe(todayKey);
    expect(daily.map((d: { date: string }) => d.date)).toEqual([...daily.map((d: { date: string }) => d.date)].sort());

    // Each bucket is a [start of day, start of next day) window
    const dayCalls = prismaMock.message.count.mock.calls.filter((c: any[]) => c[0]?.where?.createdAt?.lt);
    expect(dayCalls).toHaveLength(7);
    for (const [args] of dayCalls) {
      const { gte, lt } = args.where.createdAt;
      expect(gte.getHours()).toBe(0);
      expect(lt.getTime() - gte.getTime()).toBeGreaterThanOrEqual(23 * 3600 * 1000); // DST-safe
    }
  });

  it('forwards database errors', async () => {
    arrangeEmptyDb();
    prismaMock.post.count.mockRejectedValue(new Error('db down'));
    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.json).not.toHaveBeenCalled();
  });
});

/**
 * The platform is private: a registration is only a request until an administrator approves it. The dashboard numbers
 * therefore describe members (APPROVED), never applicants. A tiny in-memory user table stands in for PostgreSQL so these
 * tests check what the numbers MEAN, independent of the order in which the controller asks for them.
 */
describe('adminController.getStats counts members only', () => {
  type Row = {
    id: string;
    isActive: boolean;
    isVerified: boolean;
    approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
    userRole: string;
    batchYear: number;
    city: string | null;
    createdAt: Date;
    lastLoginAt: Date | null;
  };

  const now = new Date();
  const inMonth = (offset: number) => new Date(now.getFullYear(), now.getMonth() - offset, 2, 12);
  const row = (id: string, overrides: Partial<Row>): Row => ({
    id,
    isActive: true,
    isVerified: false,
    approvalStatus: 'APPROVED',
    userRole: 'MEMBER',
    batchYear: 2020,
    city: null,
    createdAt: inMonth(0),
    lastLoginAt: null,
    ...overrides,
  });

  const table: Row[] = [
    row('a', { isVerified: true, city: 'Pune', lastLoginAt: new Date() }), // approved, new this month, recently active
    row('b', { isVerified: true, userRole: 'ADMIN', city: 'Pune', createdAt: inMonth(1) }), // approved, joined last month
    row('c', { approvalStatus: 'PENDING', batchYear: 2024, city: 'Goa', lastLoginAt: new Date() }), // applicant
    row('d', { approvalStatus: 'PENDING', batchYear: 2024, city: 'Goa' }), // applicant
    row('e', { approvalStatus: 'REJECTED', batchYear: 2024, city: 'Goa', createdAt: inMonth(1) }), // turned down
    row('f', { isVerified: true, isActive: false, batchYear: 2019, city: 'Pune', createdAt: inMonth(2) }), // approved but deactivated
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches = (candidate: Row, where: Record<string, any> = {}): boolean =>
    Object.entries(where).every(([key, condition]) => {
      const value = (candidate as unknown as Record<string, unknown>)[key];
      if (condition === null || typeof condition !== 'object' || condition instanceof Date) return value === condition;
      return Object.entries(condition as Record<string, unknown>).every(([operator, operand]) => {
        if (operator === 'gte') return value != null && (value as Date) >= (operand as Date);
        if (operator === 'lt') return value != null && (value as Date) < (operand as Date);
        if (operator === 'not') return value !== operand;
        throw new Error(`the in-memory user table does not support "${key}.${operator}"`);
      });
    });

  const arrangeUserTable = () => {
    arrangeEmptyDb();
    prismaMock.user.count.mockImplementation((async (args: any) => table.filter((r) => matches(r, args?.where)).length) as any);
    prismaMock.user.groupBy.mockImplementation((async (args: any) => {
      const key = args.by[0] as keyof Row;
      const counts = new Map<unknown, number>();
      for (const r of table.filter((candidate) => matches(candidate, args.where))) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
      return [...counts].map(([value, count]) => ({ [key]: value, _count: { _all: count } }));
    }) as any);
  };

  const getData = async () => {
    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();
    return res.json.mock.calls[0][0].data;
  };

  it('counts only approved, active members as the total and the recently active', async () => {
    arrangeUserTable();
    const { users } = await getData();
    expect(users.total).toBe(2); // a, b: the pending/rejected applicants and the deactivated member are not counted
    expect(users.active).toBe(1); // a signed in within 30 days; c is an applicant who did too, and must not count
  });

  it('keeps users.verified as the number of approved members', async () => {
    arrangeUserTable();
    const { users } = await getData();
    expect(users.verified).toBe(3); // a, b, f
  });

  it('adds the number of registrations waiting for approval and the number rejected', async () => {
    arrangeUserTable();
    const { users } = await getData();
    expect(users.pendingApproval).toBe(2); // c, d
    expect(users.rejected).toBe(1); // e
  });

  it('measures new members and growth from approved users only', async () => {
    arrangeUserTable();
    const { users } = await getData();
    // This month: a (approved) - c and d are applicants. Last month: b (approved) - e was rejected.
    expect(users.newThisMonth).toBe(1);
    expect(users.growthPercent).toBe(0);
  });

  it('groups members by role, batch and city without the applicants', async () => {
    arrangeUserTable();
    const { users } = await getData();
    expect(users.byRole).toEqual(expect.arrayContaining([{ role: 'MEMBER', count: 2 }, { role: 'ADMIN', count: 1 }]));
    expect(users.byRole).toHaveLength(2);
    expect(users.byBatch).toEqual(expect.arrayContaining([{ year: 2020, count: 2 }, { year: 2019, count: 1 }]));
    expect(users.byBatch.some((b: { year: number }) => b.year === 2024)).toBe(false);
    expect(users.byLocation).toEqual([{ city: 'Pune', count: 2 }]); // Goa has applicants only; f is deactivated
  });

  it('builds the monthly registration series from approved users only', async () => {
    arrangeUserTable();
    const { users } = await getData();
    const series = users.monthlyGrowth as Array<{ month: string; count: number }>;
    expect(series).toHaveLength(12);
    // [..., two months ago, last month, this month]: f, b, a
    expect(series.slice(-3).map((m) => m.count)).toEqual([1, 1, 1]);
    expect(series.reduce((sum, m) => sum + m.count, 0)).toBe(3);
  });

  it('never asks the database for a member number without the approval filter', async () => {
    arrangeUserTable();
    await getData();
    const queries = [...prismaMock.user.count.mock.calls, ...prismaMock.user.groupBy.mock.calls].map(([args]: any[]) => args?.where?.approvalStatus);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((status: unknown) => ['APPROVED', 'PENDING', 'REJECTED'].includes(status as string))).toBe(true);
    expect(queries.filter((status: unknown) => status === 'PENDING')).toHaveLength(1);
    expect(queries.filter((status: unknown) => status === 'REJECTED')).toHaveLength(1);
  });

  it('keeps every status in the recent registrations feed and says which one each has', async () => {
    arrangeEmptyDb();
    const recent = [
      { id: 'u1', fullName: 'New Applicant', email: 'new@aiem.test', createdAt: new Date(), batchYear: 2024, approvalStatus: 'PENDING' },
      { id: 'u2', fullName: 'Rejected One', email: 'no@aiem.test', createdAt: new Date(), batchYear: 2021, approvalStatus: 'REJECTED' },
      { id: 'u3', fullName: 'A Member', email: 'm@aiem.test', createdAt: new Date(), batchYear: 2015, approvalStatus: 'APPROVED' },
    ];
    prismaMock.user.findMany.mockResolvedValue(recent);

    const { req, res, next } = mockReqRes();
    await adminController.getStats(req, res, next);
    expect(next).not.toHaveBeenCalled();

    expect(res.json.mock.calls[0][0].data.recentActivity.users).toEqual(recent);
    const feedQuery = prismaMock.user.findMany.mock.calls[0][0];
    expect(feedQuery.select).toMatchObject({ id: true, fullName: true, email: true, createdAt: true, batchYear: true, approvalStatus: true });
    expect(feedQuery.where).toBeUndefined(); // all statuses: the feed is "who registered lately"
    expect(feedQuery).toMatchObject({ take: 5, orderBy: { createdAt: 'desc' } });
  });
});

describe('GET /api/admin/stats', () => {
  beforeAll(() => {
    getApp();
  }, 120000);

  it('is admin-only', async () => {
    const { header } = authAs('MEMBER');
    await api().get('/api/admin/stats').set('Authorization', header).expect(403);
    await api().get('/api/admin/stats').expect(401);
  });

  it('returns stats to admins', async () => {
    const { header } = authAs('ADMIN');
    arrangeEmptyDb();
    // authAs wires user.findUnique; user.count etc. are arranged above
    const res = await api().get('/api/admin/stats').set('Authorization', header).expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.financial.donations.totalAmount).toBe(0);
  });
});
