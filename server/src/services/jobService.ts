import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { JobType, WorkplaceType, JobStatus, Prisma } from '@prisma/client';

interface CreateJobInput {
  title: string;
  description: string;
  company: string;
  location?: string;
  workplaceType?: WorkplaceType;
  jobType?: JobType;
  industry?: string;
  salaryMin?: number;
  salaryMax?: number;
  experienceMin?: number;
  experienceMax?: number;
  skills?: string[];
  applicationLink?: string;
  deadline?: Date | string;
}

interface JobFilters {
  jobType?: JobType;
  workplaceType?: WorkplaceType;
  location?: string;
  industry?: string;
  skills?: string;
  experience?: number;
  page?: number;
  limit?: number;
}

export class JobService {
  async getJobs(filters: JobFilters) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    const where: Prisma.JobOpportunityWhereInput = {
      status: 'PUBLISHED',
    };

    if (filters.jobType) {
      where.jobType = filters.jobType;
    }

    if (filters.workplaceType) {
      where.workplaceType = filters.workplaceType;
    }

    if (filters.location) {
      where.location = { contains: filters.location };
    }

    if (filters.industry) {
      where.industry = { contains: filters.industry };
    }

    if (filters.experience !== undefined) {
      where.experienceMin = { lte: filters.experience };
    }

    const [jobs, total] = await Promise.all([
      prisma.jobOpportunity.findMany({
        where,
        include: {
          postedBy: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              currentDesignation: true,
            },
          },
        },
        orderBy: [
          { isFeatured: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take,
      }),
      prisma.jobOpportunity.count({ where }),
    ]);

    return buildPaginationResponse(jobs, total, page, limit);
  }

  async getJob(id: string) {
    const job = await prisma.jobOpportunity.findUnique({
      where: { id },
      include: {
        postedBy: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
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

    // Increment view count
    await prisma.jobOpportunity.update({
      where: { id },
      data: { viewCount: { increment: 1 } },
    });

    return job;
  }

  async createJob(userId: string, data: CreateJobInput) {
    const job = await prisma.jobOpportunity.create({
      data: {
        postedById: userId,
        title: data.title,
        description: data.description,
        company: data.company,
        location: data.location,
        workplaceType: data.workplaceType || 'ONSITE',
        jobType: data.jobType || 'FULL_TIME',
        industry: data.industry,
        salaryMin: data.salaryMin ? new Prisma.Decimal(data.salaryMin) : null,
        salaryMax: data.salaryMax ? new Prisma.Decimal(data.salaryMax) : null,
        experienceMin: data.experienceMin,
        experienceMax: data.experienceMax,
        skills: data.skills || [],
        applicationLink: data.applicationLink,
        deadline: data.deadline ? new Date(data.deadline) : null,
        status: 'PENDING_REVIEW',
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

    return job;
  }

  async updateJob(userId: string, jobId: string, data: Partial<CreateJobInput>, isAdmin: boolean = false) {
    const job = await prisma.jobOpportunity.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new AppError('Job not found', 404, 'NOT_FOUND');
    }

    if (job.postedById !== userId && !isAdmin) {
      throw new AppError('Not authorized to update this job', 403, 'FORBIDDEN');
    }

    return prisma.jobOpportunity.update({
      where: { id: jobId },
      data: {
        ...data,
        salaryMin: data.salaryMin ? new Prisma.Decimal(data.salaryMin) : undefined,
        salaryMax: data.salaryMax ? new Prisma.Decimal(data.salaryMax) : undefined,
        deadline: data.deadline ? new Date(data.deadline) : undefined,
      },
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

  async approveJob(jobId: string) {
    const job = await prisma.jobOpportunity.update({
      where: { id: jobId },
      data: { status: 'PUBLISHED' },
    });

    // Notify the poster
    await prisma.notification.create({
      data: {
        userId: job.postedById,
        type: 'ADMIN_ANNOUNCEMENT',
        title: 'Job Approved',
        message: `Your job posting "${job.title}" has been approved and is now live.`,
        link: `/jobs/${job.id}`,
      },
    });

    return job;
  }

  async rejectJob(jobId: string, reason?: string) {
    const job = await prisma.jobOpportunity.update({
      where: { id: jobId },
      data: { status: 'REJECTED' },
    });

    // Notify the poster
    await prisma.notification.create({
      data: {
        userId: job.postedById,
        type: 'ADMIN_ANNOUNCEMENT',
        title: 'Job Not Approved',
        message: reason || `Your job posting "${job.title}" was not approved.`,
        link: `/jobs/${job.id}`,
      },
    });

    return job;
  }

  async getMyJobs(userId: string, page: number = 1, limit: number = 10) {
    const { skip, take } = paginationHelper(page, limit);

    const [jobs, total] = await Promise.all([
      prisma.jobOpportunity.findMany({
        where: { postedById: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.jobOpportunity.count({ where: { postedById: userId } }),
    ]);

    return buildPaginationResponse(jobs, total, page, limit);
  }
}

export const jobService = new JobService();
