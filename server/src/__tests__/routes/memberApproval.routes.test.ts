/**
 * The administrator's review queue through the real app: who may use it, and what the HTTP answers look like.
 */
import { api, authAs, getApp, prismaMock } from '../../../tests/helpers';

jest.mock('../../services/auditService', () => ({ logAuditAction: jest.fn().mockResolvedValue(undefined) }));

beforeAll(() => {
  getApp();
}, 60_000);
beforeEach(() => jest.clearAllMocks());

const applicant = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  fullName: 'Ada Alum',
  email: 'ada@aiem.edu',
  approvalStatus: 'PENDING',
  createdAt: new Date(),
  emailVerifiedAt: new Date(),
  ...overrides,
});

/** The administrator who makes the request is looked up by the auth middleware; `targetFor` answers for everybody else. */
const arrangeLookup = (targetFor: (id: string) => Record<string, unknown> | null | undefined) => {
  prismaMock.user.findUnique.mockImplementation(((args: any) => {
    const id = args.where.id as string;
    if (id.startsWith('00000000')) {
      return Promise.resolve({ id, email: 'admin@aiem.test', fullName: 'Admin', userRole: 'ADMIN', isActive: true, approvalStatus: 'APPROVED', tokenVersion: 0 });
    }
    return Promise.resolve(targetFor(id) ?? null);
  }) as any);
};

const ROUTES = [
  ['get', '/api/admin/approvals'],
  ['get', '/api/admin/approvals/summary'],
  ['post', '/api/admin/approvals/u1/approve'],
  ['post', '/api/admin/approvals/u1/reject'],
  ['post', '/api/admin/approvals/bulk-approve'],
  ['post', '/api/admin/approvals/bulk-reject'],
] as const;

describe.each(ROUTES)('%s %s', (method, path) => {
  it('is closed to anonymous visitors', async () => {
    const res = await api()[method](path).send({});
    expect(res.status).toBe(401);
  });

  it.each(['MEMBER', 'CHAPTER_ADMIN'] as const)('is closed to a %s', async (role) => {
    const { header } = authAs(role);
    const res = await api()[method](path).set('Authorization', header).send({});
    expect(res.status).toBe(403);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('is closed to an administrator whose own account is not approved', async () => {
    const { header } = authAs('ADMIN', { approvalStatus: 'PENDING' });
    const res = await api()[method](path).set('Authorization', header).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });
});

describe('as an administrator', () => {
  it('lists the registrations waiting for approval', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.user.findMany.mockResolvedValue([applicant()]);
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.alumniRecord.findMany.mockResolvedValue([]);
    const res = await api().get('/api/admin/approvals?status=PENDING&search=ada').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ match: { level: 'none', reason: expect.any(String) }, waitingDays: expect.any(Number) });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('passes the queue filters on', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.alumniRecord.findMany.mockResolvedValue([]);
    const res = await api().get('/api/admin/approvals?batchYear=2015&department=Civil&waitingDays=7').set('Authorization', header);
    expect(res.status).toBe(200);
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ batchYear: 2015, department: { equals: 'Civil' } });
    expect(where.createdAt.lt).toBeInstanceOf(Date);
  });

  it('answers 400 for a filter it cannot read', async () => {
    const { header } = authAs('ADMIN');
    for (const query of ['match=maybe', 'batchYear=abc', 'waitingDays=-3']) {
      const res = await api().get(`/api/admin/approvals?${query}`).set('Authorization', header);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('shows how many are waiting', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.user.groupBy.mockResolvedValue([{ approvalStatus: 'PENDING', _count: { _all: 3 } }]);
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.alumniRecord.count.mockResolvedValue(40);
    const res = await api().get('/api/admin/approvals/summary').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ pending: 3, approved: 0, rejected: 0, overdue: 2, alumniRecords: 40 });
  });

  it('approves', async () => {
    const { header } = authAs('ADMIN');
    arrangeLookup((id) => (id === 'u1' ? applicant() : undefined));
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    const res = await api().post('/api/admin/approvals/u1/approve').set('Authorization', header).send({ note: 'Seen in batch list' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.updateMany.mock.calls[0][0].data.approvalNote).toBe('Seen in batch list');
  });

  it('bulk-approves and answers per id', async () => {
    const { header } = authAs('ADMIN');
    arrangeLookup((id) => (id === 'u1' ? applicant() : id === 'u2' ? applicant({ id: 'u2', approvalStatus: 'APPROVED' }) : undefined));
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    const res = await api().post('/api/admin/approvals/bulk-approve').set('Authorization', header).send({ ids: ['u1', 'u2', 'u3'], note: 'On the list' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      succeeded: 1,
      failed: 2,
      results: [
        { id: 'u1', ok: true },
        { id: 'u2', ok: false, code: 'ALREADY_APPROVED', message: expect.any(String) },
        { id: 'u3', ok: false, code: 'NOT_FOUND', message: expect.any(String) },
      ],
    });
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
  });

  it('bulk-rejects only with a reason', async () => {
    const { header } = authAs('ADMIN');
    const res = await api().post('/api/admin/approvals/bulk-reject').set('Authorization', header).send({ ids: ['u1'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();

    arrangeLookup((id) => (id === 'u1' ? applicant() : undefined));
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    const ok = await api().post('/api/admin/approvals/bulk-reject').set('Authorization', header).send({ ids: ['u1'], reason: 'Not on the 2015 list' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it.each([
    ['no ids', { ids: [] }],
    ['no ids at all', {}],
    ['51 ids', { ids: Array.from({ length: 51 }, (_, i) => `id-${i}`) }],
    ['ids that are not text', { ids: [1, 2] }],
    ['a note that is too long', { ids: ['u1'], note: 'x'.repeat(501) }],
  ])('refuses a bulk approval with %s (400) before deciding anything', async (_label, body) => {
    const { header } = authAs('ADMIN');
    const res = await api().post('/api/admin/approvals/bulk-approve').set('Authorization', header).send(body);
    expect(res.status).toBe(400);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to reject without a reason (400)', async () => {
    const { header } = authAs('ADMIN');
    const res = await api().post('/api/admin/approvals/u1/reject').set('Authorization', header).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 404 for a registration that does not exist', async () => {
    const { header } = authAs('ADMIN');
    arrangeLookup(() => null);
    const res = await api().post('/api/admin/approvals/missing/approve').set('Authorization', header).send({});
    expect(res.status).toBe(404);
  });
});
