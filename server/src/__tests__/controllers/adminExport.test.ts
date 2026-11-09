/**
 * GET /api/admin/export/:entity through the real app: the CSV is streamed in batches, keeps its content type, file name
 * and escaping, announces a truncated file, and fails cleanly when the database does.
 */
import { api, authAs, prismaMock } from '../../../tests/helpers';

const userRow = (i: number) => ({
  id: `u${String(i).padStart(5, '0')}`,
  fullName: i === 0 ? '=HYPERLINK("http://evil")' : `User ${i}`,
  email: `u${i}@x.io`,
  batchYear: 2019,
  department: 'CSE',
  userRole: 'MEMBER',
  isActive: true,
  createdAt: new Date(Date.UTC(2026, 0, 1) - i * 1000),
});

/** Supertest buffers text/csv into `res.text` */
const get = (path: string, header: string) => api().get(path).set('Authorization', header);

describe('GET /api/admin/export/:entity', () => {
  const originalMax = process.env.EXPORT_MAX_ROWS;
  afterEach(() => {
    if (originalMax === undefined) delete process.env.EXPORT_MAX_ROWS;
    else process.env.EXPORT_MAX_ROWS = originalMax;
  });

  it('streams a CSV attachment with the usual headers and escaping', async () => {
    const admin = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.findMany.mockImplementation(async (args: any) => (args?.take ? [userRow(0), userRow(1)] : [admin.user]));

    const res = await get('/api/admin/export/users', admin.header);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="users-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers['x-export-truncated']).toBeUndefined();
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe('ID,Name,Email,Batch,Department,Role,Active,Joined');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).not.toMatch(/passwordHash|\$2[aby]\$/);
  });

  it('flags a file that is cut at the row limit: header up front, marker row at the end', async () => {
    const admin = authAs('ADMIN');
    process.env.EXPORT_MAX_ROWS = '2';
    prismaMock.user.count.mockResolvedValue(5);
    prismaMock.user.findMany.mockImplementation(async (args: any) =>
      args?.take ? [0, 1, 2, 3, 4].map(userRow).slice(0, args.take) : [admin.user]
    );

    const res = await get('/api/admin/export/users', admin.header);

    expect(res.status).toBe(200);
    expect(res.headers['x-export-truncated']).toBe('true');
    const lines = res.text.split('\r\n');
    expect(lines).toHaveLength(1 + 2 + 1);
    expect(lines[3]).toMatch(/^EXPORT TRUNCATED/);
  });

  it('lets the browser read the truncation flag and the file name across origins', async () => {
    const admin = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.findMany.mockImplementation(async (args: any) => (args?.take ? [] : [admin.user]));

    const res = await get('/api/admin/export/users', admin.header).set('Origin', 'http://localhost:3000');

    const exposed = String(res.headers['access-control-expose-headers'] ?? '').toLowerCase();
    expect(exposed).toContain('x-export-truncated');
    expect(exposed).toContain('content-disposition');
  });

  it('answers an unknown entity with a JSON 400 and no CSV headers', async () => {
    const admin = authAs('ADMIN');
    const res = await get('/api/admin/export/refreshTokens', admin.header);
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body.error.code).toBe('INVALID_EXPORT');
  });

  it('answers a database failure on the first read with a clean JSON 500, not a half-written file', async () => {
    const admin = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.user.findMany.mockImplementation(async (args: any) => {
      if (args?.take) throw new Error('db down');
      return [admin.user];
    });

    const res = await get('/api/admin/export/users', admin.header);

    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['x-export-truncated']).toBeUndefined();
    expect(res.body.success).toBe(false);
  });

  it('aborts the connection (instead of ending a short file as if it were complete) when a later batch fails', async () => {
    const admin = authAs('ADMIN');
    prismaMock.user.count.mockResolvedValue(5000);
    let batches = 0;
    prismaMock.user.findMany.mockImplementation(async (args: any) => {
      if (!args?.take) return [admin.user];
      batches++;
      if (batches > 1) throw new Error('db down');
      return Array.from({ length: args.take }, (_, i) => userRow(i));
    });

    await expect(get('/api/admin/export/users', admin.header)).rejects.toBeDefined();

    expect(batches).toBe(2);
    const audit = prismaMock.auditLog.create.mock.calls.map((c: any[]) => c[0].data).find((d: any) => d.action === 'EXPORT_DATA');
    expect(audit.newValues).toEqual({ entity: 'users', rows: 1000, truncated: false, aborted: true });
  });

  it('is for administrators only', async () => {
    const member = authAs('MEMBER');
    const res = await get('/api/admin/export/users', member.header);
    expect(res.status).toBe(403);
    expect(prismaMock.user.count).not.toHaveBeenCalled();
    const anonymous = await api().get('/api/admin/export/users');
    expect(anonymous.status).toBe(401);
  });
});
