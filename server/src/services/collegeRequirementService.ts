import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { Actor, isAdminRole } from '../config/permissions';
import { clientLinks } from '../utils/clientLinks';
import { notificationService } from './notificationService';
import { broadcastNotification } from './broadcastService';
import { RequirementCategory, RequirementStatus, Prisma } from '@prisma/client';

interface RequirementInput {
  title: string;
  description: string;
  category?: RequirementCategory;
}

const CATEGORIES = Object.values(RequirementCategory) as RequirementCategory[];
const STATUSES = Object.values(RequirementStatus) as RequirementStatus[];
const TITLE_MAX = 200;
const MAX_SEARCH = 100;

const responderSelect = { id: true, fullName: true, profilePhotoUrl: true, currentDesignation: true, batchYear: true } as const;

const assertCategory = (c: unknown): RequirementCategory => {
  if (c === undefined || c === null || c === '') return 'OTHER';
  if (!CATEGORIES.includes(c as RequirementCategory)) throw new AppError('Invalid category', 400, 'VALIDATION_ERROR');
  return c as RequirementCategory;
};

export class CollegeRequirementService {
  /** Public listing defaults to OPEN; admins may filter by any status. Includes a response count. */
  async getRequirements(filters: { status?: string; category?: string; search?: string; page?: number; limit?: number }, viewer?: Actor | null) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);
    const isAdmin = !!viewer && isAdminRole(viewer.userRole);

    let status: RequirementStatus | undefined = 'OPEN';
    if (isAdmin && filters.status) {
      if (!STATUSES.includes(filters.status as RequirementStatus)) throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
      status = filters.status as RequirementStatus;
    }

    const where: Prisma.CollegeRequirementWhereInput = status ? { status } : {};
    if (filters.category && CATEGORIES.includes(filters.category as RequirementCategory)) {
      where.category = filters.category as RequirementCategory;
    }
    const search = typeof filters.search === 'string' ? filters.search.trim().slice(0, MAX_SEARCH) : '';
    if (search) where.OR = [{ title: ilike(search) }, { description: ilike(search) }];

    const [items, total] = await Promise.all([
      prisma.collegeRequirement.findMany({
        where,
        include: { _count: { select: { responses: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.collegeRequirement.count({ where }),
    ]);
    return buildPaginationResponse(items, total, page, limit);
  }

  /** Detail. Responses are included for admins only; others see whether they've already offered. */
  async getRequirement(id: string, viewer?: Actor | null) {
    const isAdmin = !!viewer && isAdminRole(viewer.userRole);
    const requirement = await prisma.collegeRequirement.findUnique({
      where: { id },
      include: {
        _count: { select: { responses: true } },
        ...(isAdmin ? { responses: { include: { user: { select: responderSelect } }, orderBy: { createdAt: 'desc' } } } : {}),
      },
    });
    if (!requirement) throw new AppError('Requirement not found', 404, 'NOT_FOUND');

    if (!isAdmin && viewer) {
      const mine = await prisma.requirementResponse.findUnique({
        where: { requirementId_userId: { requirementId: id, userId: viewer.id } },
      });
      return { ...requirement, hasResponded: !!mine };
    }
    return requirement;
  }

  async createRequirement(adminId: string, data: RequirementInput) {
    if (typeof data?.title !== 'string' || !data.title.trim()) throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
    if (typeof data?.description !== 'string' || !data.description.trim()) throw new AppError('Description is required', 400, 'VALIDATION_ERROR');
    const requirement = await prisma.collegeRequirement.create({
      data: {
        title: data.title.trim().slice(0, TITLE_MAX),
        description: data.description.trim(),
        category: assertCategory(data.category),
        postedById: adminId,
      },
    });

    await broadcastNotification({
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'The college needs your help',
      message: `New requirement: "${requirement.title}". Can you help?`,
      link: clientLinks.requirements(),
      metadata: { requirementId: requirement.id },
      excludeUserId: adminId,
    });
    return requirement;
  }

  async updateRequirement(id: string, data: Partial<RequirementInput> & { status?: string }) {
    await this.findOrThrow(id);
    const update: Record<string, unknown> = {};
    if (data.title !== undefined) {
      if (typeof data.title !== 'string' || !data.title.trim()) throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
      update.title = data.title.trim().slice(0, TITLE_MAX);
    }
    if (data.description !== undefined) {
      if (typeof data.description !== 'string' || !data.description.trim()) throw new AppError('Description is required', 400, 'VALIDATION_ERROR');
      update.description = data.description.trim();
    }
    if (data.category !== undefined) update.category = assertCategory(data.category);
    if (data.status !== undefined) {
      if (!STATUSES.includes(data.status as RequirementStatus)) throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
      update.status = data.status;
    }
    return prisma.collegeRequirement.update({ where: { id }, data: update as Prisma.CollegeRequirementUpdateInput });
  }

  async deleteRequirement(id: string) {
    await this.findOrThrow(id);
    await prisma.collegeRequirement.delete({ where: { id } });
    return { message: 'Requirement deleted' };
  }

  /** An alum offers to help. One offer per alum; only while the requirement is OPEN. */
  async respond(userId: string, requirementId: string, message: unknown) {
    const requirement = await this.findOrThrow(requirementId);
    if (requirement.status !== 'OPEN') throw new AppError('This requirement is no longer open', 400, 'REQUIREMENT_CLOSED');
    if (typeof message !== 'string' || !message.trim()) throw new AppError('A message is required', 400, 'VALIDATION_ERROR');

    let response;
    try {
      response = await prisma.requirementResponse.create({
        data: { requirementId, userId, message: message.trim().slice(0, 2000) },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new AppError('You have already offered to help with this', 409, 'ALREADY_RESPONDED');
      }
      throw err;
    }

    // Notify admins (few of them) that a member offered to help.
    const admins = await prisma.user.findMany({
      where: { isActive: true, userRole: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true },
    });
    const responder = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    await Promise.all(
      admins.map((a) =>
        notificationService.createNotification({
          userId: a.id,
          type: 'ADMIN_ANNOUNCEMENT',
          title: 'New offer to help',
          message: `${responder?.fullName ?? 'A member'} offered to help with "${requirement.title}".`,
          link: clientLinks.adminRequirements(),
          metadata: { requirementId },
        })
      )
    );
    return response;
  }

  /** Admin accepts/declines an offer; the offering alum is notified. */
  async reviewResponse(responseId: string, accept: boolean) {
    const response = await prisma.requirementResponse.findUnique({
      where: { id: responseId },
      include: { requirement: { select: { title: true } } },
    });
    if (!response) throw new AppError('Response not found', 404, 'NOT_FOUND');

    const updated = await prisma.requirementResponse.update({
      where: { id: responseId },
      data: { status: accept ? 'ACCEPTED' : 'DECLINED' },
    });
    await notificationService.createNotification({
      userId: response.userId,
      type: 'ADMIN_ANNOUNCEMENT',
      title: accept ? 'Your offer was accepted' : 'Your offer was not taken up',
      message: accept
        ? `The college accepted your offer to help with "${response.requirement.title}". They'll be in touch.`
        : `Thanks for offering to help with "${response.requirement.title}".`,
      link: clientLinks.requirements(),
      metadata: { requirementId: response.requirementId },
    });
    return updated;
  }

  private async findOrThrow(id: string) {
    const requirement = await prisma.collegeRequirement.findUnique({ where: { id } });
    if (!requirement) throw new AppError('Requirement not found', 404, 'NOT_FOUND');
    return requirement;
  }
}

export const collegeRequirementService = new CollegeRequirementService();
