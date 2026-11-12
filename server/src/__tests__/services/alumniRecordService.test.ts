import { alumniRecordService, MAX_IMPORT_ROWS, MAX_IMPORT_ERRORS } from '../../services/alumniRecordService';
import { prismaMock } from '../../../tests/helpers';
import { logAuditAction } from '../../services/auditService';

jest.mock('../../services/auditService', () => ({ logAuditAction: jest.fn().mockResolvedValue(undefined) }));

const ADMIN = { id: 'admin-1' };
const META = { ipAddress: '10.0.0.1', userAgent: 'jest' };

const stored = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  fullName: 'Ada Alum',
  nameKey: 'ada alum',
  batchYear: 2015,
  department: 'Computer Engineering',
  enrollmentNumber: '12CE045',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.alumniRecord.findMany.mockResolvedValue([]);
  prismaMock.alumniRecord.createMany.mockImplementation(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
  prismaMock.alumniRecord.updateMany.mockResolvedValue({ count: 1 });
});

describe('importing the college list', () => {
  it('creates the records, with the enrolment number stored normalised and the name key for matching', async () => {
    const result = await alumniRecordService.importRows(
      ADMIN,
      [{ fullName: '  José   Álvarez ', batchYear: 2015, department: ' Civil ', enrollmentNumber: ' 12 ce 045 ' }],
      META
    );
    expect(result).toEqual({ created: 1, updated: 0, skipped: 0, errors: [] });
    expect(prismaMock.alumniRecord.createMany).toHaveBeenCalledWith({
      data: [
        {
          fullName: 'José Álvarez',
          nameKey: 'jose alvarez',
          batchYear: 2015,
          department: 'Civil',
          enrollmentNumber: '12CE045',
          importedById: 'admin-1',
        },
      ],
      skipDuplicates: true,
    });
  });

  it('accepts a batch year typed as text (a CSV cell) and treats blank department and enrolment number as absent', async () => {
    await alumniRecordService.importRows(ADMIN, [{ fullName: 'Ada Alum', batchYear: '2015', department: '  ', enrollmentNumber: '' }], META);
    const row = prismaMock.alumniRecord.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({ batchYear: 2015, department: null, enrollmentNumber: null });
  });

  it('looks up what exists with ONE query for the whole request (no query per row)', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ fullName: `Person ${i}`, batchYear: 2010 + (i % 5), enrollmentNumber: `E${i}` }));
    await alumniRecordService.importRows(ADMIN, rows, META);
    expect(prismaMock.alumniRecord.findMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.alumniRecord.createMany).toHaveBeenCalledTimes(1);
  });

  it('upserts by enrolment number: a changed row updates the existing record', async () => {
    prismaMock.alumniRecord.findMany.mockResolvedValue([stored()]);
    const result = await alumniRecordService.importRows(
      ADMIN,
      [{ fullName: 'Ada Alum-Lovelace', batchYear: 2015, department: 'Electrical', enrollmentNumber: '12ce045' }],
      META
    );
    expect(result).toEqual({ created: 0, updated: 1, skipped: 0, errors: [] });
    expect(prismaMock.alumniRecord.createMany).not.toHaveBeenCalled();
    expect(prismaMock.alumniRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { fullName: 'Ada Alum-Lovelace', nameKey: 'ada alum-lovelace', batchYear: 2015, department: 'Electrical', importedById: 'admin-1' },
    });
  });

  it('a row identical to the stored record changes nothing and counts as skipped', async () => {
    prismaMock.alumniRecord.findMany.mockResolvedValue([stored()]);
    const result = await alumniRecordService.importRows(
      ADMIN,
      [{ fullName: 'Ada Alum', batchYear: 2015, department: 'Computer Engineering', enrollmentNumber: '12CE045' }],
      META
    );
    expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
    expect(prismaMock.alumniRecord.updateMany).not.toHaveBeenCalled();
  });

  it('a blank department never erases the department that is already stored', async () => {
    prismaMock.alumniRecord.findMany.mockResolvedValue([stored()]);
    const result = await alumniRecordService.importRows(ADMIN, [{ fullName: 'Ada Alum', batchYear: 2015, enrollmentNumber: '12CE045' }], META);
    expect(result.skipped).toBe(1);
    expect(prismaMock.alumniRecord.updateMany).not.toHaveBeenCalled();
  });

  it('importing the same file twice does not duplicate rows that have no enrolment number', async () => {
    prismaMock.alumniRecord.findMany.mockResolvedValue([stored({ enrollmentNumber: null })]);
    const result = await alumniRecordService.importRows(
      ADMIN,
      [{ fullName: 'ADA  alum', batchYear: 2015, department: 'computer engineering' }],
      META
    );
    expect(result).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
    expect(prismaMock.alumniRecord.createMany).not.toHaveBeenCalled();
  });

  it('rejects the bad rows one by one with their row number and imports the good ones', async () => {
    const result = await alumniRecordService.importRows(
      ADMIN,
      [
        { fullName: 'Good One', batchYear: 2015 },
        { fullName: 'X', batchYear: 2015 },
        { fullName: 'No Year' },
        { fullName: 'Far Past', batchYear: 1800 },
        { fullName: 'Far Future', batchYear: 3000 },
        { fullName: 'Half Year', batchYear: 2015.5 },
        { fullName: 'Text Year', batchYear: 'soon' },
        { fullName: 'Bad Dept', batchYear: 2015, department: 'x'.repeat(101) },
        { fullName: 'Bad Number', batchYear: 2015, enrollmentNumber: 'x'.repeat(51) },
        'not an object',
        null,
        { fullName: 'Another Good', batchYear: 2016 },
      ],
      META
    );
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(10);
    expect(result.errors.map((e) => e.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.errors.every((e) => typeof e.message === 'string' && e.message.length > 0)).toBe(true);
    expect(prismaMock.alumniRecord.createMany.mock.calls[0][0].data.map((r: { fullName: string }) => r.fullName)).toEqual(['Good One', 'Another Good']);
  });

  it(`reports at most ${MAX_IMPORT_ERRORS} errors, but every bad row is still counted as skipped`, async () => {
    const rows = Array.from({ length: 60 }, () => ({ fullName: '', batchYear: 2015 }));
    const result = await alumniRecordService.importRows(ADMIN, rows, META);
    expect(result.errors).toHaveLength(MAX_IMPORT_ERRORS);
    expect(result.skipped).toBe(60);
    expect(result.created + result.updated + result.skipped).toBe(60);
  });

  it('flags a row whose enrolment number or person already appeared earlier in the same file', async () => {
    const result = await alumniRecordService.importRows(
      ADMIN,
      [
        { fullName: 'First', batchYear: 2015, enrollmentNumber: '15CE001' },
        { fullName: 'Second', batchYear: 2015, enrollmentNumber: '15 ce 001' },
        { fullName: 'Same Person', batchYear: 2016 },
        { fullName: 'same   person', batchYear: 2016 },
      ],
      META
    );
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(2);
    expect(result.errors).toEqual([
      { row: 2, message: expect.stringMatching(/row 1/i) },
      { row: 4, message: expect.stringMatching(/row 3/i) },
    ]);
  });

  it('refuses a request of more than the allowed number of rows, before touching the database', async () => {
    const rows = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ fullName: `P ${i}`, batchYear: 2015 }));
    await expect(alumniRecordService.importRows(ADMIN, rows, META)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(prismaMock.alumniRecord.findMany).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a list of rows', async () => {
    await expect(alumniRecordService.importRows(ADMIN, 'rows' as unknown as unknown[], META)).rejects.toMatchObject({ statusCode: 400 });
    await expect(alumniRecordService.importRows(ADMIN, [], META)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('counts a row that lost a race against another import (unique enrolment number) as skipped, not created', async () => {
    prismaMock.alumniRecord.createMany.mockResolvedValue({ count: 1 });
    const result = await alumniRecordService.importRows(
      ADMIN,
      [
        { fullName: 'One', batchYear: 2015, enrollmentNumber: 'A1' },
        { fullName: 'Two', batchYear: 2015, enrollmentNumber: 'A2' },
      ],
      META
    );
    expect(result).toMatchObject({ created: 1, skipped: 1 });
  });

  it('writes ONE audit entry with counts only: never the names, numbers or rows', async () => {
    await alumniRecordService.importRows(ADMIN, [{ fullName: 'Secret Person', batchYear: 2015, enrollmentNumber: 'SECRET1' }, { fullName: '' }], META);
    expect(logAuditAction).toHaveBeenCalledTimes(1);
    const entry = (logAuditAction as jest.Mock).mock.calls[0][0];
    expect(entry).toMatchObject({ userId: 'admin-1', action: 'IMPORT', entityType: 'ALUMNI_RECORD', ipAddress: '10.0.0.1' });
    expect(entry.newValues).toEqual({ rows: 2, created: 1, updated: 0, skipped: 1 });
    expect(JSON.stringify(entry)).not.toMatch(/Secret|SECRET1/);
  });
});

describe('listing the college list', () => {
  beforeEach(() => {
    prismaMock.alumniRecord.findMany.mockResolvedValue([stored()]);
    prismaMock.alumniRecord.count.mockResolvedValue(1);
  });

  it('pages, caps the page size and returns what the administrator needs (not the matching key)', async () => {
    const result = await alumniRecordService.list({ page: 2, limit: 5000 });
    const args = prismaMock.alumniRecord.findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.skip).toBe(100);
    expect(args.select.nameKey).toBeUndefined();
    expect(args.select).toMatchObject({ id: true, fullName: true, batchYear: true, department: true, enrollmentNumber: true, createdAt: true });
    expect(result.pagination.total).toBe(1);
  });

  it('searches name, department and enrolment number (normalised), and a four-digit search also means a batch year', async () => {
    await alumniRecordService.list({ search: ' 12 ce ' });
    const or = prismaMock.alumniRecord.findMany.mock.calls[0][0].where.OR;
    expect(JSON.stringify(or)).toContain('fullName');
    expect(JSON.stringify(or)).toContain('department');
    expect(or).toContainEqual({ enrollmentNumber: { contains: '12CE' } });

    prismaMock.alumniRecord.findMany.mockClear();
    await alumniRecordService.list({ search: '2015' });
    expect(prismaMock.alumniRecord.findMany.mock.calls[0][0].where.OR).toContainEqual({ batchYear: 2015 });
  });

  it('escapes LIKE wildcards in the search', async () => {
    await alumniRecordService.list({ search: '100%' });
    expect(JSON.stringify(prismaMock.alumniRecord.findMany.mock.calls[0][0].where.OR)).toContain('100\\\\%');
  });

  it('shows the newest batches first, then by name', async () => {
    await alumniRecordService.list({});
    expect(prismaMock.alumniRecord.findMany.mock.calls[0][0].orderBy).toEqual([{ batchYear: 'desc' }, { fullName: 'asc' }]);
  });
});

describe('removing a record', () => {
  it('deletes it and audits the removal without the person’s name', async () => {
    prismaMock.alumniRecord.findUnique.mockResolvedValue(stored());
    prismaMock.alumniRecord.deleteMany.mockResolvedValue({ count: 1 });
    await expect(alumniRecordService.remove(ADMIN, 'r1', META)).resolves.toEqual({ id: 'r1' });
    expect(prismaMock.alumniRecord.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1' } });
    const entry = (logAuditAction as jest.Mock).mock.calls[0][0];
    expect(entry).toMatchObject({ userId: 'admin-1', action: 'DELETE', entityType: 'ALUMNI_RECORD', entityId: 'r1' });
    expect(JSON.stringify(entry)).not.toMatch(/Ada|12CE045/);
  });

  it('answers 404 for a record that does not exist (or was removed a moment ago) and audits nothing', async () => {
    prismaMock.alumniRecord.findUnique.mockResolvedValue(null);
    await expect(alumniRecordService.remove(ADMIN, 'nope', META)).rejects.toMatchObject({ statusCode: 404 });
    prismaMock.alumniRecord.findUnique.mockResolvedValue(stored());
    prismaMock.alumniRecord.deleteMany.mockResolvedValue({ count: 0 });
    await expect(alumniRecordService.remove(ADMIN, 'r1', META)).rejects.toMatchObject({ statusCode: 404 });
    expect(logAuditAction).not.toHaveBeenCalled();
  });
});
