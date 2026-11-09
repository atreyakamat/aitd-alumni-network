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
  email: 'ada@aitd.edu',
  approvalStatus: 'PENDING',
  emailVerifiedAt: new Date(),
  ...overrides,
});

/** The administrator who makes the request is looked up by the auth middleware; `targetFor` answers for everybody else. */
const arrangeLookup = (targetFor: (id: string) => Record<string, unknown> | null | undefined) => {
  prismaMock.user.findUnique.mockImplementation(((args: any) => {
    const id = args.where.id as string;
    if (id.startsWith('00000000')) {
      return Promise.resolve({ id, email: 'admin@aitd.test', fullName: 'Admin', userRole: 'ADMIN', isActive: true, approvalStatus: 'APPROVED', tokenVersion: 0 });
    }
    return Promise.resolve(targetFor(id) ?? null);
  }) as any);
};

const ROUTES = [
  ['get', '/api/admin/approvals'],
  ['get', '/api/admin/approvals/summary'],
  ['post', '/api/admin/approvals/u1/approve'],
  ['post', '/api/admin/approvals/u1/reject'],
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
    const res = await api().get('/api/admin/approvals?status=PENDING&search=ada').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('shows how many are waiting', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.user.groupBy.mockResolvedValue([{ approvalStatus: 'PENDING', _count: { _all: 3 } }]);
    const res = await api().get('/api/admin/approvals/summary').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ pending: 3, approved: 0, rejected: 0 });
  });

  it('approves', async () => {
    const { header } = authAs('ADMIN');
    arrangeLookup((id) => (id === 'u1' ? applicant() : undefined));
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    const res = await api().post('/api/admin/approvals/u1/approve').set('Authorization', header).send({ note: 'Seen in batch list' });
    expect(res.status).toBe(200);
    expect(prismaMock.user.updateMany.mock.calls[0][0].data.approvalNote).toBe('Seen in batch list');
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
