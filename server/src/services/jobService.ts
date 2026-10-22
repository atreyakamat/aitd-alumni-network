import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { JobType, WorkplaceType, JobStatus, Prisma } from '@prisma/client';
import { isOwnerOrAdmin, Actor } from '../config/permissions';
import { notificationService } from './notificationService';
import { clientLinks } from '../utils/clientLinks';

export interface CreateJobInput {
  title: string;
  description: string;
  company: string;
  location?: string;
  workplaceType?: WorkplaceType;
  jobType?: JobType;
  industry?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  experienceMin?: number | null;
  experienceMax?: number | null;
  skills?: string[];
  applicationLink?: string;
  deadline?: Date | string | null;
}

/** Admin-only fields on top of the regular job fields. */
export interface UpdateJobInput extends Partial<CreateJobInput> {
  status?: JobStatus;
  isFeatured?: boolean;
}

export interface JobFilters {
  jobType?: JobType | string;
  workplaceType?: WorkplaceType | string;
  location?: string;
  industry?: string;
  skills?: string;
  experience?: number;
  search?: string;
  page?: number;
  limit?: number;
}

const JOB_TYPES = Object.values(JobType) as string[];
const WORKPLACE_TYPES = Object.values(WorkplaceType) as string[];
const JOB_STATUSES = Object.values(JobStatus) as string[];

/** Fields any owner may edit. Everything else (status, isFeatured, viewCount, postedById, ...) is ignored. */
const EDITABLE_FIELDS = [
  'title',
  'description',
  'company',
  'location',
  'workplaceType',
  'jobType',
  'industry',
  'salaryMin',
  'salaryMax',
  'experienceMin',
  'experienceMax',
  'skills',
  'applicationLink',
  'deadline',
] as const;

const posterSelect = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
  currentDesignation: true,
  batchYear: true,
  department: true,
};

const badRequest = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

const toNumberOrNull = (value: unknown, field: string): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw badRequest(`${field} must be a non-negative number`);
  }
  return n;
};

const toFutureDateOrNull = (value: unknown, field: string): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`${field} must be a valid date`);
  }
  if (date.getTime() <= Date.now()) {
    throw badRequest(`${field} must be in the future`);
  }
  return date;
};

const decimalToNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  return Number(value as number);
};

const assertRange = (min: number | null, max: number | null, label: string) => {
  if (min !== null && max !== null && min > max) {
    throw badRequest(`${label} minimum cannot exceed maximum`);
  }
};

const assertEnum = (value: unknown, allowed: string[], field: string) => {
  if (value !== undefined && !allowed.includes(value as string)) {
    throw badRequest(`Invalid ${field}`);
  }
};

const notifySafely = async (payload: Parameters<typeof notificationService.createNotification>[0]) => {
  try {
    await notificationService.createNotification(payload);
  } catch (err) {
    // The moderation decision is already committed; never fail it on a notification error
    console.error('Job notification failed:', err);
  }
};

export class JobService {
  /** Public job board: only PUBLISHED jobs whose deadline has not passed. */
  async getJobs(filters: JobFilters) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    assertEnum(filters.jobType, JOB_TYPES, 'job type');
    assertEnum(filters.workplaceType, WORKPLACE_TYPES, 'workplace type');

    const and: Prisma.JobOpportunityWhereInput[] = [
      { OR: [{ deadline: null }, { deadline: { gte: new Date() } }] },
    ];
    const where: Prisma.JobOpportunityWhereInput = { status: 'PUBLISHED', AND: and };

    if (filters.jobType) where.jobType = filters.jobType as JobType;
    if (filters.workplaceType) where.workplaceType = filters.workplaceType as WorkplaceType;
    if (filters.location) where.location = ilike(filters.location);
    if (filters.industry) where.industry = ilike(filters.industry);
    if (filters.skills) where.skills = { array_contains: [filters.skills] };

    if (filters.experience !== undefined && Number.isFinite(filters.experience)) {
      and.push({ OR: [{ experienceMin: null }, { experienceMin: { lte: filters.experience } }] });
    }

    const search = filters.search?.trim();
    if (search) {
      and.push({
        OR: [
          { title: ilike(search) },
          { company: ilike(search) },
          { description: ilike(search) },
          { location: ilike(search) },
          { industry: ilike(search) },
        ],
      });
    }

    const [jobs, total] = await Promise.all([
      prisma.jobOpportunity.findMany({
        where,
        include: { postedBy: { select: posterSelect } },
        orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      prisma.jobOpportunity.count({ where }),
    ]);

    return buildPaginationResponse(jobs, total, page, limit);
  }

  /**
   * Job detail. Jobs that are not PUBLISHED are only visible to their poster
   * and admins; everyone else gets a 404 so drafts/rejections don't leak.
   */
  async getJob(id: string, viewer?: Actor | null) {
    const job = await prisma.jobOpportunity.findUnique({
      where: { id },
      include: {
        postedBy: {
          select: {
            ...posterSelect,
            city: true,
            workExperiences: {
              where: { isCurrent: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!job) {
      throw new AppError('Job not found', 404, 'NOT_FOUND');
    }

    if (job.status !== 'PUBLISHED') {
      if (!isOwnerOrAdmin(viewer, job.postedById)) {
        throw new AppError('Job not found', 404, 'NOT_FOUND');
      }
      return job;
    }

    // Count views of live listings only (poster's own views excluded)
    if (viewer?.id !== job.postedById) {
      await prisma.jobOpportunity.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      });
      return { ...job, viewCount: job.viewCount + 1 };
    }

    return job;
  }

  /**
   * Members' jobs go into the admin review queue (PENDING_REVIEW);
   * admins may publish directly.
   */
  async createJob(userId: string, data: CreateJobInput, isAdmin: boolean = false) {
    const salaryMin = toNumberOrNull(data.salaryMin, 'salaryMin');
    const salaryMax = toNumberOrNull(data.salaryMax, 'salaryMax');
    const experienceMin = toNumberOrNull(data.experienceMin, 'experienceMin');
    const experienceMax = toNumberOrNull(data.experienceMax, 'experienceMax');
    assertRange(salaryMin, salaryMax, 'Salary');
    assertRange(experienceMin, experienceMax, 'Experience');
    const deadline = toFutureDateOrNull(data.deadline, 'deadline');
    assertEnum(data.jobType, JOB_TYPES, 'job type');
    assertEnum(data.workplaceType, WORKPLACE_TYPES, 'workplace type');

    return prisma.jobOpportunity.create({
      data: {
        postedById: userId,
        title: data.title,
        description: data.description,
        company: data.company,
        location: data.location,
        workplaceType: data.workplaceType || 'ONSITE',
        jobType: data.jobType || 'FULL_TIME',
        industry: data.industry,
        salaryMin: salaryMin !== null ? new Prisma.Decimal(salaryMin) : null,
        salaryMax: salaryMax !== null ? new Prisma.Decimal(salaryMax) : null,
        experienceMin,
        experienceMax,
        skills: data.skills || [],
        applicationLink: data.applicationLink,
        deadline,
        status: isAdmin ? 'PUBLISHED' : 'PENDING_REVIEW',
      },
      include: {
        postedBy: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
      },
    });
  }

  /**
   * Owner or admin only. Fields are whitelisted; `status` and `isFeatured`
   * are admin-only. When a non-admin owner edits a PUBLISHED or REJECTED job
   * it goes back to PENDING_REVIEW so edits can't bypass moderation.
   */
  async updateJob(userId: string, jobId: string, data: UpdateJobInput, isAdmin: boolean = false) {
    const job = await prisma.jobOpportunity.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new AppError('Job not found', 404, 'NOT_FOUND');
    }

    if (job.postedById !== userId && !isAdmin) {
      throw new AppError('Not authorized to update this job', 403, 'FORBIDDEN');
    }

    const input = (data || {}) as Record<string, unknown>;
    const update: Prisma.JobOpportunityUpdateInput = {};

    for (const field of EDITABLE_FIELDS) {
      if (input[field] !== undefined) {
        (update as Record<string, unknown>)[field] = input[field];
      }
    }

    assertEnum(update.jobType, JOB_TYPES, 'job type');
    assertEnum(update.workplaceType, WORKPLACE_TYPES, 'workplace type');

    for (const field of ['title', 'description', 'company'] as const) {
      if (field in update && (typeof update[field] !== 'string' || !(update[field] as string).trim())) {
        throw badRequest(`${field} cannot be empty`);
      }
    }

    if ('salaryMin' in update || 'salaryMax' in update) {
      const salaryMin = 'salaryMin' in update ? toNumberOrNull(input.salaryMin, 'salaryMin') : decimalToNumber(job.salaryMin);
      const salaryMax = 'salaryMax' in update ? toNumberOrNull(input.salaryMax, 'salaryMax') : decimalToNumber(job.salaryMax);
      assertRange(salaryMin, salaryMax, 'Salary');
      if ('salaryMin' in update) update.salaryMin = salaryMin !== null ? new Prisma.Decimal(salaryMin) : null;
      if ('salaryMax' in update) update.salaryMax = salaryMax !== null ? new Prisma.Decimal(salaryMax) : null;
    }

    if ('experienceMin' in update || 'experienceMax' in update) {
      const experienceMin = 'experienceMin' in update ? toNumberOrNull(input.experienceMin, 'experienceMin') : job.experienceMin;
      const experienceMax = 'experienceMax' in update ? toNumberOrNull(input.experienceMax, 'experienceMax') : job.experienceMax;
      assertRange(experienceMin, experienceMax, 'Experience');
      if ('experienceMin' in update) update.experienceMin = experienceMin;
      if ('experienceMax' in update) update.experienceMax = experienceMax;
    }

    if ('deadline' in update) {
      update.deadline = toFutureDateOrNull(input.deadline, 'deadline');
    }

    if (isAdmin) {
      if (input.status !== undefined) {
        assertEnum(input.status, JOB_STATUSES, 'status');
        update.status = input.status as JobStatus;
      }
      if (input.isFeatured !== undefined) {
        if (typeof input.isFeatured !== 'boolean') throw badRequest('isFeatured must be a boolean');
        update.isFeatured = input.isFeatured;
      }
    } else if (Object.keys(update).length > 0 && (job.status === 'PUBLISHED' || job.status === 'REJECTED')) {
      // Edited content must be re-reviewed before it is live again
      update.status = 'PENDING_REVIEW';
    }

    if (Object.keys(update).length === 0) {
      throw badRequest('No valid fields to update');
    }

    return prisma.jobOpportunity.update({
      where: { id: jobId },
      data: update,
    });
  }

  async deleteJob(userId: string, jobId: string, isAdmin: boolean = false) {
    const job = await prisma.jobOpportunity.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new AppError('Job not found', 404, 'NOT_FOUND');
    }

    if (job.postedById !== userId && !isAdmin) {
      throw new AppError('Not authorized to delete this job', 403, 'FORBIDDEN');
    }

    await prisma.jobOpportunity.delete({ where: { id: jobId } });
    return { message: 'Job deleted successfully' };
  }

  private async getPendingJob(jobId: string) {
    const job = await prisma.jobOpportunity.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new AppError('Job not found', 404, 'NOT_FOUND');
    }
    if (job.status !== 'PENDING_REVIEW') {
      throw new AppError(`Only jobs pending review can be moderated (current status: ${job.status})`, 400, 'INVALID_STATUS');
    }
    return job;
  }

  async approveJob(jobId: string) {
    await this.getPendingJob(jobId);

    const job = await prisma.jobOpportunity.update({
      where: { id: jobId },
      data: { status: 'PUBLISHED', rejectionReason: null },
    });

    await notifySafely({
      userId: job.postedById,
      type: 'JOB_MATCH',
      title: 'Job Approved',
      message: `Your job posting "${job.title}" has been approved and is now live.`,
      link: clientLinks.job(job.id),
      metadata: { jobId: job.id },
    });

    return job;
  }

  /**
   * The schema has no rejection-reason column, so the reason is delivered to
   * the poster via the notification (message + metadata) and recorded in the
   * audit log by the controller.
   */
  async rejectJob(jobId: string, reason?: string) {
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 1000) : undefined;

    await this.getPendingJob(jobId);

    const job = await prisma.jobOpportunity.update({
      where: { id: jobId },
      data: { status: 'REJECTED', rejectionReason: cleanReason ?? null },
    });

    await notifySafely({
      userId: job.postedById,
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'Job Not Approved',
      message: cleanReason
        ? `Your job posting "${job.title}" was not approved. Reason: ${cleanReason}`
        : `Your job posting "${job.title}" was not approved.`,
      link: clientLinks.job(job.id),
      metadata: { jobId: job.id, reason: cleanReason ?? null },
    });

    return { ...job, rejectionReason: cleanReason ?? null };
  }

  async getMyJobs(userId: string, page: number = 1, limit: number = 10) {
    const { skip, take, page: safePage, limit: safeLimit } = paginationHelper(page, limit);

    const [jobs, total] = await Promise.all([
      prisma.jobOpportunity.findMany({
        where: { postedById: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.jobOpportunity.count({ where: { postedById: userId } }),
    ]);

    return buildPaginationResponse(jobs, total, safePage, safeLimit);
  }
}

export const jobService = new JobService();
