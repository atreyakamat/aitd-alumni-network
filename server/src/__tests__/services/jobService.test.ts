jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn() },
}));

import { Prisma } from '@prisma/client';
import { jobService } from '../../services/jobService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

const notify = notificationService.createNotification as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const future = () => new Date(Date.now() + 30 * DAY).toISOString();
const past = () => new Date(Date.now() - DAY).toISOString();

const job = (overrides: Record<string, unknown> = {}) => ({
  id: 'j1',
  postedById: 'owner',
  title: 'Backend Engineer',
  description: 'Build APIs',
  company: 'Acme',
  status: 'PUBLISHED',
  salaryMin: null,
  salaryMax: null,
  experienceMin: null,
  experienceMax: null,
  viewCount: 7,
  isFeatured: false,
  ...overrides,
});

const baseInput = { title: 'Backend Engineer', description: 'Build APIs', company: 'Acme' };

beforeEach(() => {
  notify.mockReset().mockResolvedValue(undefined);
});

describe('jobService', () => {
  describe('getJobs', () => {
    beforeEach(() => {
      prismaMock.jobOpportunity.findMany.mockResolvedValue([job()]);
      prismaMock.jobOpportunity.count.mockResolvedValue(25);
    });

    it('lists only PUBLISHED, non-expired jobs, featured first, paginated', async () => {
      const result = await jobService.getJobs({ page: 2, limit: 10 });

      const args = prismaMock.jobOpportunity.findMany.mock.calls[0][0];
      expect(args.where.status).toBe('PUBLISHED');
      const deadlineClause = args.where.AND[0].OR;
      expect(deadlineClause[0]).toEqual({ deadline: null });
      expect(deadlineClause[1].deadline.gte).toBeInstanceOf(Date);
      expect(args.orderBy).toEqual([{ isOfficial: 'desc' }, { isFeatured: 'desc' }, { createdAt: 'desc' }]);
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(prismaMock.jobOpportunity.count).toHaveBeenCalledWith({ where: args.where });
      expect(result.pagination).toMatchObject({ total: 25, page: 2, limit: 10, totalPages: 3 });
      expect(result.data).toHaveLength(1);
    });

    it('applies type, workplace, location, industry, skills and experience filters', async () => {
      await jobService.getJobs({
        jobType: 'INTERNSHIP',
        workplaceType: 'REMOTE',
        location: 'Pune',
        industry: 'Fintech',
        skills: 'React',
        experience: 3,
      });

      const { where } = prismaMock.jobOpportunity.findMany.mock.calls[0][0];
      expect(where.jobType).toBe('INTERNSHIP');
      expect(where.workplaceType).toBe('REMOTE');
      expect(where.location).toEqual({ contains: 'Pune', mode: 'insensitive' });
      expect(where.industry).toEqual({ contains: 'Fintech', mode: 'insensitive' });
      expect(where.skills).toEqual({ array_contains: ['React'] });
      expect(where.AND).toContainEqual({ OR: [{ experienceMin: null }, { experienceMin: { lte: 3 } }] });
    });

    it('keyword search matches title, company, description, location and industry', async () => {
      await jobService.getJobs({ search: '  node  ' });
      const { where } = prismaMock.jobOpportunity.findMany.mock.calls[0][0];
      expect(where.AND).toContainEqual({
        OR: [
          { title: { contains: 'node', mode: 'insensitive' } },
          { company: { contains: 'node', mode: 'insensitive' } },
          { description: { contains: 'node', mode: 'insensitive' } },
          { location: { contains: 'node', mode: 'insensitive' } },
          { industry: { contains: 'node', mode: 'insensitive' } },
        ],
      });
      // the status gate is never relaxed by search
      expect(where.status).toBe('PUBLISHED');
    });

    it('ignores blank search and NaN experience', async () => {
      await jobService.getJobs({ search: '   ', experience: NaN });
      const { where } = prismaMock.jobOpportunity.findMany.mock.calls[0][0];
      expect(where.AND).toHaveLength(1);
    });

    it('rejects unknown job / workplace types with 400', async () => {
      await expect(jobService.getJobs({ jobType: 'WIZARD' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(jobService.getJobs({ workplaceType: 'MOON' })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.jobOpportunity.findMany).not.toHaveBeenCalled();
    });

    it('clamps oversized page sizes', async () => {
      const result = await jobService.getJobs({ page: 1, limit: 10_000 });
      expect(prismaMock.jobOpportunity.findMany.mock.calls[0][0].take).toBe(100);
      expect(result.pagination.limit).toBe(100);
    });
  });

  describe('getJob', () => {
    it('404s for a missing job', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(null);
      await expect(jobService.getJob('nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns a published job to anonymous viewers and increments viewCount', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      const result = await jobService.getJob('j1');
      expect(prismaMock.jobOpportunity.update).toHaveBeenCalledWith({
        where: { id: 'j1' },
        data: { viewCount: { increment: 1 } },
      });
      expect(result.viewCount).toBe(8);
    });

    it("does not count the poster's own views", async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      const result = await jobService.getJob('j1', { id: 'owner', userRole: 'MEMBER' });
      expect(prismaMock.jobOpportunity.update).not.toHaveBeenCalled();
      expect(result.viewCount).toBe(7);
    });

    it.each(['PENDING_REVIEW', 'REJECTED', 'DRAFT', 'CLOSED'])(
      'hides a %s job from anonymous users and other members (404)',
      async (status) => {
        prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status }));
        await expect(jobService.getJob('j1')).rejects.toMatchObject({ statusCode: 404 });
        await expect(jobService.getJob('j1', { id: 'stranger', userRole: 'MEMBER' })).rejects.toMatchObject({
          statusCode: 404,
        });
        await expect(jobService.getJob('j1', { id: 'ca', userRole: 'CHAPTER_ADMIN' })).rejects.toMatchObject({
          statusCode: 404,
        });
      }
    );

    it('shows a non-published job to its owner and to admins without counting a view', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));
      await expect(jobService.getJob('j1', { id: 'owner', userRole: 'MEMBER' })).resolves.toMatchObject({ id: 'j1' });
      await expect(jobService.getJob('j1', { id: 'adm', userRole: 'ADMIN' })).resolves.toMatchObject({ id: 'j1' });
      await expect(jobService.getJob('j1', { id: 'sa', userRole: 'SUPER_ADMIN' })).resolves.toMatchObject({ id: 'j1' });
      expect(prismaMock.jobOpportunity.update).not.toHaveBeenCalled();
    });
  });

  describe('createJob', () => {
    beforeEach(() => {
      prismaMock.jobOpportunity.create.mockImplementation(async (args: any) => ({ id: 'new', ...args.data }));
    });

    it("puts a member's job into PENDING_REVIEW with defaults", async () => {
      await jobService.createJob('u1', baseInput as any);
      const { data } = prismaMock.jobOpportunity.create.mock.calls[0][0];
      expect(data).toMatchObject({
        postedById: 'u1',
        status: 'PENDING_REVIEW',
        workplaceType: 'ONSITE',
        jobType: 'FULL_TIME',
        skills: [],
        salaryMin: null,
        salaryMax: null,
        deadline: null,
      });
    });

    it('lets admins publish directly, marked official', async () => {
      await jobService.createJob('adm', baseInput as any, true);
      const { data } = prismaMock.jobOpportunity.create.mock.calls[0][0];
      expect(data.status).toBe('PUBLISHED');
      expect(data.isOfficial).toBe(true);
    });

    it("marks a member's job non-official", async () => {
      await jobService.createJob('u1', baseInput as any);
      expect(prismaMock.jobOpportunity.create.mock.calls[0][0].data.isOfficial).toBe(false);
    });

    it('stores salaries as Decimals (including 0) and the deadline as a Date', async () => {
      const deadline = future();
      await jobService.createJob('u1', {
        ...baseInput,
        salaryMin: 0,
        salaryMax: 1200000,
        experienceMin: 1,
        experienceMax: 3,
        skills: ['TS'],
        jobType: 'CONTRACT',
        workplaceType: 'HYBRID',
        deadline,
      } as any);
      const { data } = prismaMock.jobOpportunity.create.mock.calls[0][0];
      expect(data.salaryMin).toBeInstanceOf(Prisma.Decimal);
      expect(data.salaryMin.toNumber()).toBe(0);
      expect(data.salaryMax.toNumber()).toBe(1200000);
      expect(data.deadline).toEqual(new Date(deadline));
      expect(data).toMatchObject({ experienceMin: 1, experienceMax: 3, skills: ['TS'], jobType: 'CONTRACT', workplaceType: 'HYBRID' });
    });

    it.each([
      ['salaryMin > salaryMax', { salaryMin: 200, salaryMax: 100 }],
      ['negative salary', { salaryMin: -1 }],
      ['non-numeric salary', { salaryMax: 'lots' }],
      ['experienceMin > experienceMax', { experienceMin: 5, experienceMax: 2 }],
      ['deadline in the past', { deadline: past() }],
      ['invalid deadline', { deadline: 'not-a-date' }],
      ['unknown job type', { jobType: 'GIG' }],
      ['unknown workplace type', { workplaceType: 'SPACE' }],
    ])('rejects %s with 400', async (_label, extra) => {
      await expect(jobService.createJob('u1', { ...baseInput, ...extra } as any)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(prismaMock.jobOpportunity.create).not.toHaveBeenCalled();
    });
  });

  describe('updateJob', () => {
    beforeEach(() => {
      prismaMock.jobOpportunity.update.mockImplementation(async (args: any) => ({ id: 'j1', ...args.data }));
    });

    it('404s for a missing job', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(null);
      await expect(jobService.updateJob('owner', 'nope', { title: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('403s for non-owners who are not admins', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      await expect(jobService.updateJob('stranger', 'j1', { title: 'x' })).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.jobOpportunity.update).not.toHaveBeenCalled();
    });

    it('whitelists fields and blocks status/isFeatured/viewCount/postedById for owners', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));
      await jobService.updateJob('owner', 'j1', {
        title: 'Senior Backend Engineer',
        status: 'PUBLISHED',
        isFeatured: true,
        viewCount: 999,
        postedById: 'hijack',
        id: 'other',
      } as any);
      expect(prismaMock.jobOpportunity.update).toHaveBeenCalledWith({
        where: { id: 'j1' },
        data: { title: 'Senior Backend Engineer' },
      });
    });

    it.each(['PUBLISHED', 'REJECTED'])('sends a %s job back to review when its owner edits it', async (status) => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status }));
      await jobService.updateJob('owner', 'j1', { description: 'Updated' });
      expect(prismaMock.jobOpportunity.update.mock.calls[0][0].data).toEqual({
        description: 'Updated',
        status: 'PENDING_REVIEW',
      });
    });

    it('leaves the status of a CLOSED job alone on owner edits', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'CLOSED' }));
      await jobService.updateJob('owner', 'j1', { description: 'Updated' });
      expect(prismaMock.jobOpportunity.update.mock.calls[0][0].data.status).toBeUndefined();
    });

    it('lets admins edit any job, set status/isFeatured, without forcing re-review', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      await jobService.updateJob('adm', 'j1', { title: 'Edited', isFeatured: true, status: 'CLOSED' }, true);
      expect(prismaMock.jobOpportunity.update.mock.calls[0][0].data).toEqual({
        title: 'Edited',
        isFeatured: true,
        status: 'CLOSED',
      });
    });

    it('validates admin-only values', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      await expect(jobService.updateJob('adm', 'j1', { status: 'LIVE' } as any, true)).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(jobService.updateJob('adm', 'j1', { isFeatured: 'yes' } as any, true)).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('validates salary range against the stored value', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ salaryMax: new Prisma.Decimal(100) }));
      await expect(jobService.updateJob('owner', 'j1', { salaryMin: 500 })).rejects.toMatchObject({ statusCode: 400 });

      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ salaryMin: new Prisma.Decimal(100) }));
      await jobService.updateJob('owner', 'j1', { salaryMax: 150 });
      const { data } = prismaMock.jobOpportunity.update.mock.calls[0][0];
      expect(data.salaryMax.toNumber()).toBe(150);
      expect(data.salaryMin).toBeUndefined();
    });

    it('can clear salaries with null and validates experience ranges', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'DRAFT', experienceMax: 2 }));
      await jobService.updateJob('owner', 'j1', { salaryMin: null, salaryMax: null });
      expect(prismaMock.jobOpportunity.update.mock.calls[0][0].data).toEqual({ salaryMin: null, salaryMax: null });

      await expect(jobService.updateJob('owner', 'j1', { experienceMin: 4 })).rejects.toMatchObject({ statusCode: 400 });
      await jobService.updateJob('owner', 'j1', { experienceMin: 1, experienceMax: 6 });
      expect(prismaMock.jobOpportunity.update.mock.calls[1][0].data).toEqual({ experienceMin: 1, experienceMax: 6 });
    });

    it('requires a future deadline (or null to clear it)', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'DRAFT' }));
      await expect(jobService.updateJob('owner', 'j1', { deadline: past() })).rejects.toMatchObject({ statusCode: 400 });

      const deadline = future();
      await jobService.updateJob('owner', 'j1', { deadline });
      expect(prismaMock.jobOpportunity.update.mock.calls[0][0].data.deadline).toEqual(new Date(deadline));

      await jobService.updateJob('owner', 'j1', { deadline: null });
      expect(prismaMock.jobOpportunity.update.mock.calls[1][0].data.deadline).toBeNull();
    });

    it('rejects empty required text fields, bad enums and no-op updates', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      await expect(jobService.updateJob('owner', 'j1', { title: '  ' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(jobService.updateJob('owner', 'j1', { jobType: 'GIG' } as any)).rejects.toMatchObject({ statusCode: 400 });
      await expect(jobService.updateJob('owner', 'j1', {})).rejects.toMatchObject({ statusCode: 400 });
      await expect(jobService.updateJob('owner', 'j1', { isFeatured: true })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.jobOpportunity.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteJob', () => {
    it('404s for a missing job', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(null);
      await expect(jobService.deleteJob('owner', 'nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('403s for non-owners', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      await expect(jobService.deleteJob('stranger', 'j1')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.jobOpportunity.delete).not.toHaveBeenCalled();
    });

    it('lets the owner or an admin delete', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job());
      await expect(jobService.deleteJob('owner', 'j1')).resolves.toEqual({ message: 'Job deleted successfully' });
      await jobService.deleteJob('adm', 'j1', true);
      expect(prismaMock.jobOpportunity.delete).toHaveBeenCalledTimes(2);
      expect(prismaMock.jobOpportunity.delete).toHaveBeenCalledWith({ where: { id: 'j1' } });
    });
  });

  describe('approveJob', () => {
    it('publishes a pending job and notifies the poster', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));
      prismaMock.jobOpportunity.update.mockResolvedValue(job({ status: 'PUBLISHED' }));

      const result = await jobService.approveJob('j1');

      expect(prismaMock.jobOpportunity.update).toHaveBeenCalledWith({ where: { id: 'j1' }, data: { status: 'PUBLISHED', rejectionReason: null } });
      expect(result.status).toBe('PUBLISHED');
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner', title: 'Job Approved', link: '/jobs/j1', metadata: { jobId: 'j1' } })
      );
    });

    it('404s for a missing job', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(null);
      await expect(jobService.approveJob('nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    it.each(['PUBLISHED', 'REJECTED', 'DRAFT', 'CLOSED'])('refuses to approve a %s job', async (status) => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status }));
      await expect(jobService.approveJob('j1')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_STATUS' });
      expect(prismaMock.jobOpportunity.update).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
    });

    it('still succeeds when the notification fails', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));
      prismaMock.jobOpportunity.update.mockResolvedValue(job({ status: 'PUBLISHED' }));
      notify.mockRejectedValue(new Error('smtp down'));
      await expect(jobService.approveJob('j1')).resolves.toMatchObject({ status: 'PUBLISHED' });
    });

    it('clears any earlier rejection reason when approving', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));
      prismaMock.jobOpportunity.update.mockResolvedValue(job({ status: 'PUBLISHED' }));
      await jobService.approveJob('j1');
      expect(prismaMock.jobOpportunity.update).toHaveBeenCalledWith({
        where: { id: 'j1' },
        data: { status: 'PUBLISHED', rejectionReason: null },
      });
    });
  });

  describe('rejectJob', () => {
    beforeEach(() => {
      prismaMock.jobOpportunity.update.mockResolvedValue(job({ status: 'REJECTED' }));
    });

    it('rejects a pending job, returns and notifies the trimmed reason', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));

      const result = await jobService.rejectJob('j1', '  Missing salary info  ');

      expect(prismaMock.jobOpportunity.update).toHaveBeenCalledWith({
        where: { id: 'j1' },
        data: { status: 'REJECTED', rejectionReason: 'Missing salary info' },
      });
      expect(result.rejectionReason).toBe('Missing salary info');
      const payload = notify.mock.calls[0][0];
      expect(payload.userId).toBe('owner');
      expect(payload.message).toContain('Missing salary info');
      expect(payload.metadata).toEqual({ jobId: 'j1', reason: 'Missing salary info' });
    });

    it('works without a reason', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));
      const result = await jobService.rejectJob('j1', '   ');
      expect(result.rejectionReason).toBeNull();
      expect(notify.mock.calls[0][0].message).toBe('Your job posting "Backend Engineer" was not approved.');
      expect(notify.mock.calls[0][0].metadata.reason).toBeNull();
    });

    it('caps very long reasons', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PENDING_REVIEW' }));
      const result = await jobService.rejectJob('j1', 'x'.repeat(5000));
      expect(result.rejectionReason).toHaveLength(1000);
    });

    it('only rejects jobs pending review', async () => {
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(job({ status: 'PUBLISHED' }));
      await expect(jobService.rejectJob('j1', 'nope')).rejects.toMatchObject({ statusCode: 400 });
      prismaMock.jobOpportunity.findUnique.mockResolvedValue(null);
      await expect(jobService.rejectJob('j1')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.jobOpportunity.update).not.toHaveBeenCalled();
    });
  });

  describe('getMyJobs', () => {
    it("returns the caller's jobs of every status, paginated", async () => {
      prismaMock.jobOpportunity.findMany.mockResolvedValue([job({ status: 'REJECTED' })]);
      prismaMock.jobOpportunity.count.mockResolvedValue(11);

      const result = await jobService.getMyJobs('owner', 2, 5);

      expect(prismaMock.jobOpportunity.findMany).toHaveBeenCalledWith({
        where: { postedById: 'owner' },
        orderBy: { createdAt: 'desc' },
        skip: 5,
        take: 5,
      });
      expect(result.pagination).toMatchObject({ total: 11, page: 2, limit: 5, totalPages: 3 });
    });

    it('uses defaults', async () => {
      prismaMock.jobOpportunity.findMany.mockResolvedValue([]);
      prismaMock.jobOpportunity.count.mockResolvedValue(0);
      const result = await jobService.getMyJobs('owner');
      expect(result.pagination).toMatchObject({ page: 1, limit: 10, total: 0 });
    });
  });
});
