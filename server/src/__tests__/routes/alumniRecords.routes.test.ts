/**
 * The college alumni list through the real app: who may use it, what a request must look like, what the answers look like.
 */
import { api, authAs, getApp, prismaMock } from '../../../tests/helpers';
import { MAX_IMPORT_ROWS } from '../../services/alumniRecordService';

jest.mock('../../services/auditService', () => ({ logAuditAction: jest.fn().mockResolvedValue(undefined) }));

beforeAll(() => {
  getApp();
}, 60_000);
beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.alumniRecord.findMany.mockResolvedValue([]);
  prismaMock.alumniRecord.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
});

const RECORD_ID = '11111111-1111-4111-8111-111111111111';

const ROUTES = [
  ['post', '/api/admin/alumni-records/import'],
  ['get', '/api/admin/alumni-records'],
  ['delete', `/api/admin/alumni-records/${RECORD_ID}`],
] as const;

describe.each(ROUTES)('%s %s', (method, path) => {
  it('is closed to anonymous visitors', async () => {
    expect((await api()[method](path).send({})).status).toBe(401);
  });

  it.each(['MEMBER', 'CHAPTER_ADMIN'] as const)('is closed to a %s: the list is personal data of people who have not registered', async (role) => {
    const { header } = authAs(role);
    const res = await api()[method](path).set('Authorization', header).send({});
    expect(res.status).toBe(403);
    expect(prismaMock.alumniRecord.findMany).not.toHaveBeenCalled();
    expect(prismaMock.alumniRecord.createMany).not.toHaveBeenCalled();
    expect(prismaMock.alumniRecord.deleteMany).not.toHaveBeenCalled();
  });

  it('is closed to an administrator whose own account is not approved', async () => {
    const { header } = authAs('ADMIN', { approvalStatus: 'PENDING' });
    const res = await api()[method](path).set('Authorization', header).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
  });
});

describe('POST /api/admin/alumni-records/import', () => {
  const post = (body: unknown) => {
    const { header } = authAs('ADMIN');
    return api().post('/api/admin/alumni-records/import').set('Authorization', header).send(body as object);
  };

  it('imports and answers with the counts and the bad rows by number', async () => {
    const res = await post({ rows: [{ fullName: 'Ada Alum', batchYear: 2015, enrollmentNumber: '12ce045' }, { fullName: '', batchYear: 2015 }] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { created: 1, updated: 0, skipped: 1, errors: [{ row: 2, message: expect.any(String) }] } });
    expect(prismaMock.alumniRecord.createMany.mock.calls[0][0].data[0]).toMatchObject({ enrollmentNumber: '12CE045', importedById: expect.any(String) });
  });

  it.each([
    ['no rows', { rows: [] }],
    ['no body', {}],
    ['rows that are not a list', { rows: 'Ada' }],
    ['rows that are not objects', { rows: ['Ada Alum'] }],
    [`more than ${MAX_IMPORT_ROWS} rows`, { rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ fullName: `Person ${i}`, batchYear: 2015 })) }],
    ['a name of 10,000 characters', { rows: [{ fullName: 'x'.repeat(10_000), batchYear: 2015 }] }],
    ['a name that is not text', { rows: [{ fullName: { $gt: '' }, batchYear: 2015 }] }],
    ['a batch year that is an object', { rows: [{ fullName: 'Ada Alum', batchYear: { a: 1 } }] }],
  ])('refuses %s with 400 and writes nothing', async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prismaMock.alumniRecord.createMany).not.toHaveBeenCalled();
  });

  it(`accepts exactly ${MAX_IMPORT_ROWS} rows`, async () => {
    const res = await post({ rows: Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => ({ fullName: `Person ${i}`, batchYear: 2015, enrollmentNumber: `E${i}` })) });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(MAX_IMPORT_ROWS);
  });

  it('never echoes a row back, not even in a validation error', async () => {
    const res = await post({ rows: [{ fullName: 'Secret Person', batchYear: 2015, enrollmentNumber: { nested: 'SECRET-NUMBER' } }] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/Secret Person|SECRET-NUMBER/);
  });

  it('answers with at most 20 errors for a file full of bad rows', async () => {
    const res = await post({ rows: Array.from({ length: 100 }, () => ({ fullName: 'A', batchYear: 2015 })) });
    expect(res.status).toBe(200);
    expect(res.body.data.errors).toHaveLength(20);
    expect(res.body.data.skipped).toBe(100);
  });
});

describe('GET /api/admin/alumni-records', () => {
  it('lists a page with the search', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.alumniRecord.findMany.mockResolvedValue([
      { id: RECORD_ID, fullName: 'Ada Alum', batchYear: 2015, department: null, enrollmentNumber: '12CE045', createdAt: new Date() },
    ]);
    prismaMock.alumniRecord.count.mockResolvedValue(1);
    const res = await api().get('/api/admin/alumni-records?search=ada&page=1&limit=10').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ total: 1, page: 1, limit: 10 });
    expect(JSON.stringify(res.body)).not.toMatch(/nameKey/);
  });
});

describe('DELETE /api/admin/alumni-records/:id', () => {
  it('removes a record', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.alumniRecord.findUnique.mockResolvedValue({ id: RECORD_ID, batchYear: 2015 });
    prismaMock.alumniRecord.deleteMany.mockResolvedValue({ count: 1 });
    const res = await api().delete(`/api/admin/alumni-records/${RECORD_ID}`).set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: RECORD_ID } });
  });

  it('answers 404 for a record that does not exist and 400 for an id that is not one', async () => {
    const { header } = authAs('ADMIN');
    prismaMock.alumniRecord.findUnique.mockResolvedValue(null);
    expect((await api().delete(`/api/admin/alumni-records/${RECORD_ID}`).set('Authorization', header)).status).toBe(404);
    expect((await api().delete('/api/admin/alumni-records/not-an-id').set('Authorization', header)).status).toBe(400);
  });
});
