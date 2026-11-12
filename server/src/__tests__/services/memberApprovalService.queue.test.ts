/**
 * The review queue helpers: the match against the college list, the filters, "waiting N days" and the bulk decisions.
 */
import { memberApprovalService } from '../../services/memberApprovalService';
import { config } from '../../config';
import { prismaMock } from '../../../tests/helpers';
import { logAuditAction } from '../../services/auditService';
import { publishNotificationEvent } from '../../services/notificationBus';
import { log } from '../../utils/logger';

jest.mock('../../services/auditService', () => ({ logAuditAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/notificationBus', () => ({ publishNotificationEvent: jest.fn().mockResolvedValue(undefined) }));

const ADMIN = { id: 'admin-1', userRole: 'ADMIN' as const };
const META = { ipAddress: '10.0.0.1', userAgent: 'jest' };
const DAY = 24 * 60 * 60 * 1000;

const applicant = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  fullName: 'Ada Alum',
  email: 'ada@aiem.edu',
  batchYear: 2015,
  department: 'Computer Engineering',
  degree: 'B.E.',
  roleType: 'ALUMNI',
  enrollmentNumber: '12CE045',
  verificationNote: null,
  linkedinUrl: null,
  isActive: true,
  createdAt: new Date(Date.now() - 10 * DAY),
  emailVerifiedAt: new Date(),
  approvalStatus: 'PENDING',
  approvalReviewedAt: null,
  approvalNote: null,
  approvalReviewedBy: null,
  ...overrides,
});

const listRecord = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  nameKey: 'ada alum',
  batchYear: 2015,
  department: 'Computer Engineering',
  enrollmentNumber: '12CE045',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  config.auth.requireEmailVerification = false;
  prismaMock.alumniRecord.findMany.mockResolvedValue([]);
});

describe('review queue: match against the college list', () => {
  beforeEach(() => {
    prismaMock.user.count.mockResolvedValue(2);
  });

  it('gives every registration of the page its match, computed with one query for the page', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      applicant(),
      applicant({ id: 'u2', fullName: 'Stranger', enrollmentNumber: null, batchYear: 2020 }),
    ]);
    prismaMock.alumniRecord.findMany.mockResolvedValue([listRecord()]);
    const result = await memberApprovalService.list({});
    expect(prismaMock.alumniRecord.findMany).toHaveBeenCalledTimes(1);
    expect(result.data[0].match).toMatchObject({ level: 'exact', recordId: 'rec-1', record: { batchYear: 2015, department: 'Computer Engineering' } });
    expect(result.data[1].match).toMatchObject({ level: 'none' });
    expect(result.data[1].match.recordId).toBeUndefined();
  });

  it('never exposes another person’s record: no name, no number', async () => {
    prismaMock.user.findMany.mockResolvedValue([applicant({ fullName: 'Somebody Else' })]);
    prismaMock.alumniRecord.findMany.mockResolvedValue([listRecord({ nameKey: 'ada alum' })]);
    const result = await memberApprovalService.list({});
    const text = JSON.stringify(result.data[0].match);
    expect(text).not.toMatch(/ada alum/i);
    expect(text).not.toMatch(/nameKey|fullName/);
  });
});

describe('review queue: waiting days and the filters', () => {
  beforeEach(() => {
    prismaMock.user.findMany.mockResolvedValue([applicant(), applicant({ id: 'u2', createdAt: new Date(Date.now() - 2 * DAY + 60_000) })]);
    prismaMock.user.count.mockResolvedValue(2);
  });

  it('says how many whole days each waiting application has waited', async () => {
    const result = await memberApprovalService.list({});
    expect(result.data.map((r: { waitingDays: number }) => r.waitingDays)).toEqual([10, 1]);
  });

  it('is null for a registration that was already decided', async () => {
    prismaMock.user.findMany.mockResolvedValue([applicant({ approvalStatus: 'REJECTED' })]);
    const result = await memberApprovalService.list({ status: 'REJECTED' });
    expect(result.data[0].waitingDays).toBeNull();
  });

  it('filters by batch year', async () => {
    await memberApprovalService.list({ batchYear: '2015' });
    expect(prismaMock.user.findMany.mock.calls[0][0].where.batchYear).toBe(2015);
  });

  it('filters by department, case-insensitively', async () => {
    await memberApprovalService.list({ department: ' computer engineering ' });
    expect(prismaMock.user.findMany.mock.calls[0][0].where.department).toEqual({ equals: 'computer engineering', mode: 'insensitive' });
  });

  it('filters the applications that have waited MORE than N days', async () => {
    const before = Date.now();
    await memberApprovalService.list({ waitingDays: '7' });
    const lt: Date = prismaMock.user.findMany.mock.calls[0][0].where.createdAt.lt;
    expect(lt).toBeInstanceOf(Date);
    expect(Math.abs(before - lt.getTime() - 7 * DAY)).toBeLessThan(5000);
  });

  it('keeps the filters together with the search and the status', async () => {
    await memberApprovalService.list({ status: 'PENDING', search: 'ada', batchYear: 2015, department: 'Civil', waitingDays: 3 });
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ approvalStatus: 'PENDING', batchYear: 2015, department: { equals: 'Civil' } });
    expect(where.OR).toHaveLength(3);
    expect(where.createdAt.lt).toBeInstanceOf(Date);
    // the count uses the same where, so the pagination is right
    expect(prismaMock.user.count.mock.calls[0][0].where).toEqual(where);
  });

  it.each([
    [{ batchYear: 'abc' }],
    [{ batchYear: '20.5' }],
    [{ batchYear: 99999 }],
    [{ waitingDays: '-1' }],
    [{ waitingDays: 'many' }],
    [{ waitingDays: 100000 }],
    [{ match: 'maybe' }],
    [{ department: 'x'.repeat(101) }],
  ])('refuses a filter it cannot read (%j) instead of listing everybody', async (filters) => {
    await expect(memberApprovalService.list(filters as never)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
});

describe('review queue: filtering by match', () => {
  const candidate = (id: string, over: Record<string, unknown> = {}) => ({ id, fullName: `Person ${id}`, batchYear: 2015, enrollmentNumber: `E-${id}`, ...over });

  const arrange = (levels: Record<string, 'exact' | 'probable' | 'none'>) => {
    const ids = Object.keys(levels);
    const records = ids
      .filter((id) => levels[id] !== 'none')
      .map((id) => listRecord({ id: `rec-${id}`, nameKey: levels[id] === 'exact' ? `person ${id}` : 'someone else', enrollmentNumber: `E-${id}`.toUpperCase(), batchYear: 2015 }));
    prismaMock.alumniRecord.findMany.mockResolvedValue(records);
    prismaMock.user.findMany.mockResolvedValueOnce(ids.map((id) => candidate(id)));
    return ids;
  };

  it('returns only the registrations at that level, with a pagination that counts them', async () => {
    arrange({ a: 'exact', b: 'probable', c: 'none', d: 'exact' });
    prismaMock.user.findMany.mockResolvedValueOnce([applicant({ id: 'd' }), applicant({ id: 'a' })]);
    const result = await memberApprovalService.list({ match: 'exact' });
    expect(result.data.map((r: { id: string }) => r.id)).toEqual(['a', 'd']);
    expect(result.data.every((r: { match: { level: string } }) => r.match.level === 'exact')).toBe(true);
    expect(result.pagination.total).toBe(2);
    // the page itself is fetched by id, in the order of the queue
    expect(prismaMock.user.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['a', 'd'] } });
  });

  it('pages over the matches, not over the whole queue', async () => {
    arrange({ a: 'exact', b: 'exact', c: 'exact' });
    prismaMock.user.findMany.mockResolvedValueOnce([applicant({ id: 'c' })]);
    const result = await memberApprovalService.list({ match: 'exact', page: 2, limit: 2 });
    expect(prismaMock.user.findMany.mock.calls[1][0].where).toEqual({ id: { in: ['c'] } });
    expect(result.pagination).toMatchObject({ total: 3, page: 2, limit: 2 });
  });

  it('reads the queue in chunks, with one list query per chunk, and stops at a bound', async () => {
    const full = Array.from({ length: 500 }, (_, i) => candidate(`p${i}`));
    prismaMock.user.findMany.mockResolvedValue(full);
    prismaMock.alumniRecord.findMany.mockResolvedValue([]);
    await memberApprovalService.list({ match: 'none' });
    const scans = prismaMock.user.findMany.mock.calls.filter((c: unknown[]) => (c[0] as { select?: { id?: boolean } }).select?.id && !(c[0] as { where: { id?: unknown } }).where.id);
    expect(scans.length).toBeLessThanOrEqual(10);
    expect(prismaMock.alumniRecord.findMany.mock.calls.length).toBe(scans.length);
  });

  it('only asks the database for what matching needs while scanning (no e-mail, no notes)', async () => {
    arrange({ a: 'none' });
    prismaMock.user.findMany.mockResolvedValueOnce([]);
    await memberApprovalService.list({ match: 'exact' });
    const select = prismaMock.user.findMany.mock.calls[0][0].select;
    expect(select).toEqual({ id: true, fullName: true, batchYear: true, enrollmentNumber: true });
  });
});

describe('summary', () => {
  it('counts the applications that have waited 7 days or more, and how many records the college list holds', async () => {
    prismaMock.user.groupBy.mockResolvedValue([{ approvalStatus: 'PENDING', _count: { _all: 9 } }]);
    prismaMock.user.count.mockResolvedValue(4);
    prismaMock.alumniRecord.count.mockResolvedValue(350);
    const before = Date.now();
    const summary = await memberApprovalService.summary();
    expect(summary).toEqual({ pending: 9, approved: 0, rejected: 0, overdue: 4, alumniRecords: 350 });
    const where = prismaMock.user.count.mock.calls[0][0].where;
    expect(where.approvalStatus).toBe('PENDING');
    expect(Math.abs(before - where.createdAt.lte.getTime() - 7 * DAY)).toBeLessThan(5000);
  });
});

describe('bulk decisions', () => {
  /** Who exists, and in which state: the same lookups the single decision does. */
  const arrange = (people: Record<string, Record<string, unknown> | null>) => {
    prismaMock.user.findUnique.mockImplementation(((args: { where: { id: string } }) => {
      const found = people[args.where.id];
      return Promise.resolve(found === undefined || found === null ? null : { ...applicant({ id: args.where.id }), ...found });
    }) as never);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
  };

  describe('approving', () => {
    it('runs every id through the same rules as the single approval and says what happened to each, in order', async () => {
      config.auth.requireEmailVerification = true;
      arrange({
        a: {},
        b: { approvalStatus: 'APPROVED' },
        c: { emailVerifiedAt: null },
        d: null,
        e: {},
      });
      const result = await memberApprovalService.bulkApprove(ADMIN, ['a', 'b', 'c', 'd', 'e'], ' Matched the list ', META);
      expect(result).toEqual({
        succeeded: 2,
        failed: 3,
        results: [
          { id: 'a', ok: true },
          { id: 'b', ok: false, code: 'ALREADY_APPROVED', message: expect.any(String) },
          { id: 'c', ok: false, code: 'EMAIL_NOT_VERIFIED', message: expect.any(String) },
          { id: 'd', ok: false, code: 'NOT_FOUND', message: expect.any(String) },
          { id: 'e', ok: true },
        ],
      });
      expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(2);
      expect(prismaMock.user.updateMany.mock.calls[0][0].data).toMatchObject({
        approvalStatus: 'APPROVED',
        isVerified: true,
        approvalReviewedById: 'admin-1',
        approvalNote: 'Matched the list',
      });
    });

    it('a failure of one id never stops the others, even an unexpected one, and nothing of it leaks', async () => {
      arrange({ a: {}, b: {}, c: {} });
      jest.spyOn(log, 'error').mockImplementation(() => undefined);
      prismaMock.user.updateMany.mockImplementation((async (args: { where: { id: string } }) => {
        if (args.where.id === 'b') throw new Error('connection to db-internal.example:5432 refused, password=hunter2');
        return { count: 1 };
      }) as never);
      const result = await memberApprovalService.bulkApprove(ADMIN, ['a', 'b', 'c'], undefined, META);
      expect(result.results.map((r) => [r.id, r.ok])).toEqual([['a', true], ['b', false], ['c', true]]);
      expect(result.results[1]).toMatchObject({ code: 'INTERNAL_ERROR' });
      expect(JSON.stringify(result)).not.toMatch(/hunter2|db-internal/);
      expect(log.error).toHaveBeenCalled();
    });

    it('audits every person and publishes an event for every person approved, and none for the others', async () => {
      arrange({ a: {}, b: { approvalStatus: 'APPROVED' }, c: {} });
      await memberApprovalService.bulkApprove(ADMIN, ['a', 'b', 'c'], undefined, META);
      expect((logAuditAction as jest.Mock).mock.calls.map((c) => [c[0].action, c[0].entityId, c[0].userId])).toEqual([
        ['APPROVE', 'a', 'admin-1'],
        ['APPROVE', 'c', 'admin-1'],
      ]);
      expect((publishNotificationEvent as jest.Mock).mock.calls.map((c) => [c[0], c[1].userId])).toEqual([
        ['registration.approved', 'a'],
        ['registration.approved', 'c'],
      ]);
    });

    it('loses a race cleanly, per id', async () => {
      arrange({ a: {}, b: {} });
      prismaMock.user.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      const result = await memberApprovalService.bulkApprove(ADMIN, ['a', 'b'], undefined, META);
      expect(result.results[0]).toMatchObject({ ok: false, code: 'ALREADY_APPROVED' });
      expect(result.results[1]).toEqual({ id: 'b', ok: true });
    });

    it('decides a repeated id once', async () => {
      arrange({ a: {} });
      const result = await memberApprovalService.bulkApprove(ADMIN, ['a', 'a', ' a '], undefined, META);
      expect(result.results).toEqual([{ id: 'a', ok: true }]);
      expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
    });

    it('answers with ids and codes only: no name, no e-mail address of anybody', async () => {
      arrange({ a: {}, b: { approvalStatus: 'APPROVED' }, c: null });
      const result = await memberApprovalService.bulkApprove(ADMIN, ['a', 'b', 'c'], undefined, META);
      expect(JSON.stringify(result)).not.toMatch(/Ada|aiem\.edu|@/);
    });

    it.each([
      ['no ids', []],
      ['more than 50 ids', Array.from({ length: 51 }, (_, i) => `id-${i}`)],
      ['something that is not a list', 'a,b'],
      ['ids that are not text', ['a', 42]],
      ['a blank id', ['a', '  ']],
      ['an overlong id', ['x'.repeat(129)]],
    ])('refuses %s before anything is decided', async (_label, ids) => {
      await expect(memberApprovalService.bulkApprove(ADMIN, ids as never, undefined, META)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    });

    it('accepts exactly 50 ids', async () => {
      const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`);
      arrange(Object.fromEntries(ids.map((id) => [id, {}])));
      const result = await memberApprovalService.bulkApprove(ADMIN, ids, undefined, META);
      expect(result.succeeded).toBe(50);
    });

    it('refuses a note that is too long before anything is decided', async () => {
      arrange({ a: {} });
      await expect(memberApprovalService.bulkApprove(ADMIN, ['a'], 'x'.repeat(501), META)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('rejecting', () => {
    it('needs a reason, always, before anything is decided', async () => {
      arrange({ a: {} });
      await expect(memberApprovalService.bulkReject(ADMIN, ['a'], undefined, META)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      await expect(memberApprovalService.bulkReject(ADMIN, ['a'], '  ', META)).rejects.toMatchObject({ statusCode: 400 });
      await expect(memberApprovalService.bulkReject(ADMIN, ['a'], 'ab', META)).rejects.toMatchObject({ statusCode: 400 });
      await expect(memberApprovalService.bulkReject(ADMIN, ['a'], 'x'.repeat(501), META)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
    });

    it('rejects each person with the same reason, through the same rules as the single rejection', async () => {
      arrange({ a: {}, b: { approvalStatus: 'APPROVED' }, c: null, d: {} });
      const result = await memberApprovalService.bulkReject(ADMIN, ['a', 'b', 'c', 'd'], ' Not on the 2015 list ', META);
      expect(result).toEqual({
        succeeded: 2,
        failed: 2,
        results: [
          { id: 'a', ok: true },
          { id: 'b', ok: false, code: 'NOT_PENDING', message: expect.any(String) },
          { id: 'c', ok: false, code: 'NOT_FOUND', message: expect.any(String) },
          { id: 'd', ok: true },
        ],
      });
      expect(prismaMock.user.updateMany.mock.calls[0][0].data).toMatchObject({ approvalStatus: 'REJECTED', approvalNote: 'Not on the 2015 list' });
      expect((logAuditAction as jest.Mock).mock.calls.map((c) => [c[0].action, c[0].entityId])).toEqual([['REJECT', 'a'], ['REJECT', 'd']]);
      expect((publishNotificationEvent as jest.Mock).mock.calls.map((c) => [c[0], c[1]])).toEqual([
        ['registration.rejected', { userId: 'a', reason: 'Not on the 2015 list' }],
        ['registration.rejected', { userId: 'd', reason: 'Not on the 2015 list' }],
      ]);
    });

    it('refuses more than 50 ids', async () => {
      await expect(
        memberApprovalService.bulkReject(ADMIN, Array.from({ length: 51 }, (_, i) => `id-${i}`), 'Not on the list', META)
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
