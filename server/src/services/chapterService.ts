import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { Actor, isAdminRole } from '../config/permissions';
import { Prisma } from '@prisma/client';
import { normalizeUrlFields } from '../utils/safeUrl';
import { idText, optionalText, requiredText } from '../utils/inputGuards';

const EDITABLE_FIELDS = ['name', 'description', 'region', 'logoUrl'] as const;
const MAX_SEARCH_LENGTH = 100;

export interface ChapterFilters {
  search?: string;
  region?: string;
}

const cleanText = (value: unknown, max = MAX_SEARCH_LENGTH) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

interface CreateChapterInput {
  name: string;
  description?: string;
  region: string;
  adminUserId?: string;
  logoUrl?: string;
}

export class ChapterService {
  /**
   * Public chapter listing. `search` matches name/description, `region` is an
   * exact match; `regions` lists every active region so the UI can offer a
   * filter without loading all chapters.
   */
  async getChapters(page: number = 1, limit: number = 20, filters: ChapterFilters = {}) {
    const pg = paginationHelper(page, limit);
    const { skip, take } = pg;

    const where: Prisma.ChapterWhereInput = { isActive: true };
    const region = cleanText(filters.region);
    if (region) where.region = region;
    const search = cleanText(filters.search);
    if (search) {
      where.OR = [{ name: ilike(search) }, { description: ilike(search) }];
    }

    const [chapters, total, regionRows] = await Promise.all([
      prisma.chapter.findMany({
        where,
        include: {
          admin: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
            },
          },
          _count: {
            select: {
              memberships: true,
              events: true,
            },
          },
        },
        orderBy: { memberCount: 'desc' },
        skip,
        take,
      }),
      prisma.chapter.count({ where }),
      prisma.chapter.findMany({
        where: { isActive: true },
        distinct: ['region'],
        select: { region: true },
        orderBy: { region: 'asc' },
      }),
    ]);

    return {
      ...buildPaginationResponse(chapters, total, pg.page, pg.limit),
      regions: (regionRows ?? []).map(r => r.region).filter(Boolean),
    };
  }

  /** Public chapter detail. Inactive chapters are hidden; member details live behind /members (auth). */
  async getChapter(id: string) {
    const chapter = await prisma.chapter.findUnique({
      where: { id },
      include: {
        admin: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
          },
        },
        events: {
          where: {
            status: 'PUBLISHED',
            startDate: { gte: new Date() },
          },
          orderBy: { startDate: 'asc' },
          take: 5,
        },
        _count: {
          select: {
            memberships: true,
            events: true,
          },
        },
      },
    });

    if (!chapter || !chapter.isActive) {
      throw new AppError('Chapter not found', 404, 'NOT_FOUND');
    }

    return chapter;
  }

  async createChapter(data: CreateChapterInput) {
    if (!data || typeof data.name !== 'string' || !data.name.trim()) {
      throw new AppError('Chapter name is required', 400, 'VALIDATION_ERROR');
    }
    if (typeof data.region !== 'string' || !data.region.trim()) {
      throw new AppError('Chapter region is required', 400, 'VALIDATION_ERROR');
    }

    const name = data.name.trim();
    const existing = await prisma.chapter.findUnique({ where: { name } });
    if (existing) {
      throw new AppError('A chapter with this name already exists', 409, 'DUPLICATE_CHAPTER');
    }

    const description = optionalText(data.description, 'description');
    const adminUserId = data.adminUserId === undefined || data.adminUserId === null ? undefined : idText(data.adminUserId, 'adminUserId');

    const links: Record<string, unknown> = { logoUrl: data.logoUrl };
    normalizeUrlFields(links, { media: ['logoUrl'] });

    return prisma.chapter.create({
      data: {
        name,
        description,
        region: data.region.trim(),
        adminUserId,
        logoUrl: links.logoUrl as string | null | undefined,
      },
    });
  }

  async updateChapter(actor: Actor, id: string, data: Partial<CreateChapterInput>) {
    const chapter = await prisma.chapter.findUnique({ where: { id } });
    if (!chapter) {
      throw new AppError('Chapter not found', 404, 'NOT_FOUND');
    }

    if (!isAdminRole(actor.userRole) && chapter.adminUserId !== actor.id) {
      throw new AppError('Only the admin of this chapter can update it', 403, 'FORBIDDEN');
    }

    const updates: Partial<CreateChapterInput> = {};
    for (const field of EDITABLE_FIELDS) {
      if (data[field] !== undefined) (updates as any)[field] = data[field];
    }
    // name and region are required columns: a blank or non-text value must not overwrite them
    if ('name' in updates) (updates as Record<string, unknown>).name = requiredText(updates.name, 'name');
    if ('region' in updates) (updates as Record<string, unknown>).region = requiredText(updates.region, 'region');
    if ('description' in updates) (updates as Record<string, unknown>).description = optionalText(updates.description, 'description');
    normalizeUrlFields(updates as Record<string, unknown>, { media: ['logoUrl'] });

    return prisma.chapter.update({
      where: { id },
      data: updates,
    });
  }

  async deleteChapter(id: string) {
    const chapter = await prisma.chapter.findUnique({ where: { id } });
    if (!chapter) {
      throw new AppError('Chapter not found', 404, 'NOT_FOUND');
    }

    await prisma.chapter.update({
      where: { id },
      data: { isActive: false },
    });

    return { message: 'Chapter deactivated' };
  }

  async joinChapter(userId: string, chapterId: string) {
    const chapter = await prisma.chapter.findUnique({
      where: { id: chapterId },
    });

    if (!chapter || !chapter.isActive) {
      throw new AppError('Chapter not found', 404, 'NOT_FOUND');
    }

    // Check if already a member
    const existingMembership = await prisma.chapterMembership.findUnique({
      where: { chapterId_userId: { chapterId, userId } },
    });

    if (existingMembership) {
      throw new AppError('Already a member of this chapter', 409, 'ALREADY_MEMBER');
    }

    try {
      await prisma.$transaction(async tx => {
        await tx.chapterMembership.create({
          data: { chapterId, userId },
        });
        await tx.chapter.update({
          where: { id: chapterId },
          data: { memberCount: { increment: 1 } },
        });
      });
    } catch (error: any) {
      // Concurrent join lost the race on the (chapterId, userId) unique key
      if (error?.code === 'P2002') {
        throw new AppError('Already a member of this chapter', 409, 'ALREADY_MEMBER');
      }
      throw error;
    }

    return { message: 'Joined chapter successfully' };
  }

  async leaveChapter(userId: string, chapterId: string) {
    const membership = await prisma.chapterMembership.findUnique({
      where: { chapterId_userId: { chapterId, userId } },
    });

    if (!membership) {
      throw new AppError('Not a member of this chapter', 400, 'NOT_MEMBER');
    }

    await prisma.$transaction(async tx => {
      await tx.chapterMembership.delete({
        where: { id: membership.id },
      });
      // Decrement member count, never below zero
      await tx.chapter.updateMany({
        where: { id: chapterId, memberCount: { gt: 0 } },
        data: { memberCount: { decrement: 1 } },
      });
    });

    return { message: 'Left chapter successfully' };
  }

  async getChapterMembers(chapterId: string, page: number = 1, limit: number = 20) {
    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter || !chapter.isActive) {
      throw new AppError('Chapter not found', 404, 'NOT_FOUND');
    }

    const pg = paginationHelper(page, limit);

    const [members, total] = await Promise.all([
      prisma.chapterMembership.findMany({
        where: { chapterId },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              batchYear: true,
              currentDesignation: true,
              city: true,
            },
          },
        },
        orderBy: { joinedAt: 'desc' },
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.chapterMembership.count({ where: { chapterId } }),
    ]);

    return buildPaginationResponse(
      members.map(m => ({ ...m.user, joinedAt: m.joinedAt })),
      total,
      pg.page,
      pg.limit
    );
  }

  async getUserChapters(userId: string) {
    const memberships = await prisma.chapterMembership.findMany({
      where: { userId, chapter: { isActive: true } },
      include: {
        chapter: true,
      },
      orderBy: { joinedAt: 'desc' },
    });

    return memberships.map(m => ({
      ...m.chapter,
      joinedAt: m.joinedAt,
    }));
  }

  // Admin: Assign chapter admin (promotes plain members to CHAPTER_ADMIN)
  async assignAdmin(chapterId: string, adminUserIdInput: unknown) {
    const adminUserId = idText(adminUserIdInput, 'userId');
    const chapter = await prisma.chapter.findUnique({ where: { id: chapterId } });
    if (!chapter || !chapter.isActive) {
      throw new AppError('Chapter not found', 404, 'NOT_FOUND');
    }

    const user = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, userRole: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }

    // Both writes in one transaction so we never point a chapter at an admin whose role
    // was left unpromoted by a failure between the two updates.
    const updated = await prisma.$transaction(async (tx) => {
      const chapterUpdate = await tx.chapter.update({
        where: { id: chapterId },
        data: { adminUserId },
      });
      if (user.userRole === 'MEMBER') {
        await tx.user.update({ where: { id: adminUserId }, data: { userRole: 'CHAPTER_ADMIN' } });
      }
      return chapterUpdate;
    });

    return updated;
  }
}

export const chapterService = new ChapterService();
