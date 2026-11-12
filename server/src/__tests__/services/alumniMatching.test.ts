/**
 * Matching a registration against the college list: exact / probable / none.
 */
import { alumniRecordService } from '../../services/alumniRecordService';
import { prismaMock } from '../../../tests/helpers';

const record = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  nameKey: 'ada alum',
  batchYear: 2015,
  department: 'Computer Engineering',
  enrollmentNumber: '12CE045',
  ...over,
});

const applicant = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  fullName: 'Ada Alum',
  batchYear: 2015,
  enrollmentNumber: '12CE045',
  ...over,
});

const matchOne = async (a: Record<string, unknown>, records: Record<string, unknown>[]) => {
  prismaMock.alumniRecord.findMany.mockResolvedValue(records);
  const result = await alumniRecordService.matchApplicants([a as never]);
  return result.get(a.id as string)!;
};

beforeEach(() => {
  jest.clearAllMocks();
  prismaMock.alumniRecord.findMany.mockResolvedValue([]);
});

describe('exact match', () => {
  it('the enrolment number, the batch year and the name all agree', async () => {
    const match = await matchOne(applicant(), [record()]);
    expect(match).toMatchObject({ level: 'exact', recordId: 'rec-1', record: { batchYear: 2015, department: 'Computer Engineering' } });
    expect(match.reason).toMatch(/enrolment number/i);
  });

  it('writes the enrolment number the way the list does: case and spaces do not matter', async () => {
    const match = await matchOne(applicant({ enrollmentNumber: ' 12 ce 045 ' }), [record()]);
    expect(match.level).toBe('exact');
  });

  it('ignores case, doubled spaces and accents in the name', async () => {
    const match = await matchOne(applicant({ fullName: '  JOSE   alvarez ' }), [record({ nameKey: 'jose alvarez' })]);
    expect(match.level).toBe('exact');
  });

  it('is NOT exact when the number is on the list but the name is a different person: somebody typing another person’s number must not be waved through', async () => {
    const match = await matchOne(applicant({ fullName: 'Somebody Else' }), [record()]);
    expect(match.level).toBe('probable');
    expect(match.recordId).toBe('rec-1');
    expect(match.reason).toMatch(/name differs/i);
  });

  it('is NOT exact when the batch year differs, whatever the number says', async () => {
    const match = await matchOne(applicant({ batchYear: 2016 }), [record()]);
    expect(match.level).toBe('none');
    expect(match.recordId).toBeUndefined();
    expect(match.reason).toMatch(/different batch/i);
  });

  it('is NOT exact when the applicant gave no batch year', async () => {
    const match = await matchOne(applicant({ batchYear: null }), [record()]);
    expect(match.level).not.toBe('exact');
  });
});

describe('probable match', () => {
  it('the same name and the same batch year, without a number to compare', async () => {
    const match = await matchOne(applicant({ enrollmentNumber: null }), [record()]);
    expect(match).toMatchObject({ level: 'probable', recordId: 'rec-1', record: { batchYear: 2015, department: 'Computer Engineering' } });
  });

  it('the applicant’s number is not on the list, but the name and batch are', async () => {
    const match = await matchOne(applicant({ enrollmentNumber: '99ZZ999' }), [record({ enrollmentNumber: null })]);
    expect(match.level).toBe('probable');
  });

  it('a name typed without accents matches the list entry with them', async () => {
    const match = await matchOne(applicant({ fullName: 'Zoe Muller', enrollmentNumber: null }), [record({ nameKey: 'zoe muller' })]);
    expect(match.level).toBe('probable');
  });

  it('never when the batch year differs', async () => {
    const match = await matchOne(applicant({ enrollmentNumber: null, batchYear: 2014 }), [record()]);
    expect(match.level).toBe('none');
  });
});

describe('no match', () => {
  it('is none, with a reason, when nothing on the list fits', async () => {
    const match = await matchOne(applicant({ fullName: 'Nobody Known', enrollmentNumber: 'X1' }), []);
    expect(match).toEqual({ level: 'none', reason: expect.stringMatching(/not (found )?on the college list/i) });
  });

  it('never hands out anything of another person’s record', async () => {
    const match = await matchOne(applicant({ fullName: 'Nobody Known', enrollmentNumber: 'X1' }), []);
    expect(JSON.stringify(match)).not.toMatch(/Ada|12CE045|rec-1/);
    const different = await matchOne(applicant({ batchYear: 2016 }), [record()]);
    expect(JSON.stringify(different)).not.toMatch(/12CE045|Computer|rec-1/);
  });
});

describe('looking the whole page up', () => {
  it('uses ONE query for any number of applicants', async () => {
    prismaMock.alumniRecord.findMany.mockResolvedValue([
      record(),
      record({ id: 'rec-2', nameKey: 'ben batch', batchYear: 2018, enrollmentNumber: '18CE010', department: 'Civil' }),
    ]);
    const applicants = [
      applicant(),
      applicant({ id: 'u2', fullName: 'Ben Batch', batchYear: 2018, enrollmentNumber: '18 ce 010' }),
      applicant({ id: 'u3', fullName: 'Stranger', batchYear: 2020, enrollmentNumber: null }),
    ];
    const result = await alumniRecordService.matchApplicants(applicants as never[]);
    expect(prismaMock.alumniRecord.findMany).toHaveBeenCalledTimes(1);
    expect([...result.entries()].map(([id, m]) => [id, m.level])).toEqual([
      ['u1', 'exact'],
      ['u2', 'exact'],
      ['u3', 'none'],
    ]);
  });

  it('asks only for the numbers and the (batch, name) pairs of this page', async () => {
    await alumniRecordService.matchApplicants([applicant(), applicant({ id: 'u2', fullName: 'Ben Batch', batchYear: 2018, enrollmentNumber: null })] as never[]);
    const where = prismaMock.alumniRecord.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ enrollmentNumber: { in: ['12CE045'] } });
    expect(where.OR).toContainEqual({ batchYear: 2015, nameKey: { in: ['ada alum'] } });
    expect(where.OR).toContainEqual({ batchYear: 2018, nameKey: { in: ['ben batch'] } });
  });

  it('does not query at all for an empty page', async () => {
    await expect(alumniRecordService.matchApplicants([])).resolves.toEqual(new Map());
    expect(prismaMock.alumniRecord.findMany).not.toHaveBeenCalled();
  });
});
