/**
 * Wrong-typed input must be a 400, never a 500, on the college features that take free-form fields, and the limits
 * that protect members from each other (referral asks) must hold.
 *
 * These cases came from the contract suite's "wrong body field types" fuzz, which found Prisma validation errors
 * (HTTP 500) when a number, boolean, array or object was sent where text was expected.
 */
jest.mock('../../services/broadcastService', () => ({ broadcastNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../utils/storage', () => ({
  ...jest.requireActual('../../utils/storage'),
  deleteFromStorage: jest.fn().mockResolvedValue(undefined),
}));

import { collegeVideoService } from '../../services/collegeVideoService';
import { collegeMagazineService } from '../../services/collegeMagazineService';
import { referralService } from '../../services/referralService';
import { digestService } from '../../services/digestService';
import { prismaMock } from '../../../tests/helpers';

const WRONG_TYPES: Array<[string, unknown]> = [
  ['a number', 12345],
  ['a boolean', true],
  ['an array', ['a', 1]],
  ['an object', { a: 1 }],
];

describe('videos: description and category', () => {
  beforeEach(() => {
    prismaMock.collegeVideo.findUnique.mockResolvedValue({ id: 'v1', title: 'T', submittedById: 'u1', status: 'APPROVED' } as any);
    prismaMock.collegeVideo.update.mockImplementation((args: any) => Promise.resolve({ id: 'v1', ...args.data }) as any);
  });

  it.each(WRONG_TYPES)('refuses %s as the description', async (_label, description) => {
    await expect(collegeVideoService.updateVideo('v1', { description } as any)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(prismaMock.collegeVideo.update).not.toHaveBeenCalled();
  });

  it.each(WRONG_TYPES)('refuses %s as the category', async (_label, category) => {
    await expect(collegeVideoService.updateVideo('v1', { category } as any)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('keeps text, trims it, and lets null clear it', async () => {
    await collegeVideoService.updateVideo('v1', { description: '  Convocation 2026  ', category: 'Campus' });
    expect(prismaMock.collegeVideo.update.mock.calls[0][0].data).toMatchObject({ description: 'Convocation 2026', category: 'Campus' });

    await collegeVideoService.updateVideo('v1', { description: null, category: '' } as any);
    expect(prismaMock.collegeVideo.update.mock.calls[1][0].data).toMatchObject({ description: null, category: null });
  });

  it('bounds the length', async () => {
    await expect(collegeVideoService.updateVideo('v1', { description: 'x'.repeat(5001) })).rejects.toMatchObject({ statusCode: 400 });
    await expect(collegeVideoService.updateVideo('v1', { category: 'x'.repeat(101) })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('magazine: edition, description, isPublished', () => {
  beforeEach(() => {
    prismaMock.collegeMagazine.findUnique.mockResolvedValue({ id: 'm1', title: 'T' } as any);
    prismaMock.collegeMagazine.update.mockImplementation((args: any) => Promise.resolve({ id: 'm1', ...args.data }) as any);
  });

  it.each(WRONG_TYPES)('refuses %s as the edition and the description', async (_label, value) => {
    await expect(collegeMagazineService.updateMagazine('m1', { edition: value } as any)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    await expect(collegeMagazineService.updateMagazine('m1', { description: value } as any)).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.collegeMagazine.update).not.toHaveBeenCalled();
  });

  it.each([['a number', 1], ['a string', 'yes'], ['null', null], ['an array', [true]], ['an object', { a: 1 }]])(
    'refuses %s as isPublished',
    async (_label, isPublished) => {
      await expect(collegeMagazineService.updateMagazine('m1', { isPublished } as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.collegeMagazine.update).not.toHaveBeenCalled();
    }
  );

  it('accepts text, null and a real boolean', async () => {
    await collegeMagazineService.updateMagazine('m1', { edition: 'Vol 12', description: null, isPublished: false } as any);
    expect(prismaMock.collegeMagazine.update.mock.calls[0][0].data).toMatchObject({ edition: 'Vol 12', description: null, isPublished: false });
  });
});

describe('referrals', () => {
  const ask = (overrides: Record<string, unknown> = {}) =>
    referralService.createRequest('me', { targetId: 'them', company: 'Acme', message: 'please refer me', ...overrides } as any);

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'them', isActive: true, fullName: 'Me' } as any);
    prismaMock.referralRequest.count.mockResolvedValue(0);
    prismaMock.referralRequest.findFirst.mockResolvedValue(null);
    prismaMock.jobOpportunity.findUnique.mockResolvedValue({ id: 'job1' } as any);
    prismaMock.referralRequest.create.mockImplementation((args: any) => Promise.resolve({ id: 'r1', ...args.data }) as any);
  });

  it.each(WRONG_TYPES)('refuses %s as the job', async (_label, jobId) => {
    await expect(ask({ jobId })).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(prismaMock.referralRequest.create).not.toHaveBeenCalled();
  });

  it('answers 404 for a job that does not exist', async () => {
    prismaMock.jobOpportunity.findUnique.mockResolvedValue(null);
    await expect(ask({ jobId: 'ghost' })).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.referralRequest.create).not.toHaveBeenCalled();
  });

  it('accepts a real job, and no job at all', async () => {
    await expect(ask({ jobId: 'job1' })).resolves.toMatchObject({ jobId: 'job1' });
    await expect(ask()).resolves.toMatchObject({ jobId: null });
  });

  it('refuses asking the same member again about the same company or job (the database index cannot: NULL job ids never collide)', async () => {
    prismaMock.referralRequest.findFirst.mockResolvedValue({ id: 'earlier' } as any);
    await expect(ask()).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_REQUESTED' });
    expect(prismaMock.referralRequest.create).not.toHaveBeenCalled();
    const where = prismaMock.referralRequest.findFirst.mock.calls[0][0]!.where as any;
    expect(where).toMatchObject({ requesterId: 'me', targetId: 'them', jobId: null });
  });

  it('counts pending asks and checks for duplicates under a per-member lock, so parallel requests cannot overshoot', async () => {
    await ask();
    const lock = (prismaMock.$executeRaw.mock.calls[0][0] as unknown as string[]).join('?');
    expect(lock).toContain('pg_advisory_xact_lock');
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('bounds the company name', async () => {
    await expect(ask({ company: 'x'.repeat(201) })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('digest settings', () => {
  beforeEach(() => {
    prismaMock.digestSettings.findUnique.mockResolvedValue(null);
    prismaMock.digestSettings.upsert.mockImplementation((args: any) => Promise.resolve({ id: 'default', ...args.update }) as any);
  });

  it.each([['a string', 'jobs,events'], ['a number', 5], ['an array', ['jobs']], ['null', null]])('refuses %s as sections', async (_label, sections) => {
    await expect(digestService.updateSettings({ sections } as any)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(prismaMock.digestSettings.upsert).not.toHaveBeenCalled();
  });

  it('refuses unknown sections and non-boolean values', async () => {
    await expect(digestService.updateSettings({ sections: { jobs: 'yes' } } as any)).rejects.toMatchObject({ statusCode: 400 });
    await expect(digestService.updateSettings({ sections: { nonsense: true } } as any)).rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.digestSettings.upsert).not.toHaveBeenCalled();
  });

  it('merges a partial update of known sections', async () => {
    await digestService.updateSettings({ sections: { jobs: false } });
    expect(prismaMock.digestSettings.upsert.mock.calls[0][0].update.sections).toEqual({
      nearbyAlumni: true, jobs: false, events: true, videos: true, requirements: true,
    });
  });
});
