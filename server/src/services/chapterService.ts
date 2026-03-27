import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';

interface CreateChapterInput {
  name: string;
  description?: string;
  region: string;
  adminUserId?: string;
  logoUrl?: string;
}

export class ChapterService {
  async getChapters(page: number = 1, limit: number = 20) {
    const { skip, take } = paginationHelper(page, limit);

    const [chapters, total] = await Promise.all([
      prisma.chapter.findMany({
        where: { isActive: true },
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
      prisma.chapter.count({ where: { isActive: true } }),
    ]);

    return buildPaginationResponse(chapters, total, page, limit);
  }

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
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                profilePhotoUrl: true,
                batchYear: true,
              },
            },
          },
          take: 20,
        },
      },
    });

    if (!chapter) {
      throw new AppError('Chapter not found', 404, 'NOT_FOUND');
    }

    return chapter;
  }

  async createChapter(data: CreateChapterInput) {
    return prisma.chapter.create({
      data: {
        name: data.name,
        description: data.description,
        region: data.region,
        adminUserId: data.adminUserId,
        logoUrl: data.logoUrl,
      },
    });
  }

  async updateChapter(id: string, data: Partial<CreateChapterInput>) {
    return prisma.chapter.update({
      where: { id },
      data,
    });
  }

  async deleteChapter(id: string) {
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
      throw new AppError('Already a member of this chapter', 400, 'ALREADY_MEMBER');
    }

    await prisma.chapterMembership.create({
      data: { chapterId, userId },
    });

    // Increment member count
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { memberCount: { increment: 1 } },
    });

    return { message: 'Joined chapter successfully' };
  }

  async leaveChapter(userId: string, chapterId: string) {
    const membership = await prisma.chapterMembership.findUnique({
      where: { chapterId_userId: { chapterId, userId } },
    });

    if (!membership) {
      throw new AppError('Not a member of this chapter', 400, 'NOT_MEMBER');
    }

    await prisma.chapterMembership.delete({
      where: { id: membership.id },
    });

    // Decrement member count
    await prisma.chapter.update({
      where: { id: chapterId },
      data: { memberCount: { decrement: 1 } },
    });

    return { message: 'Left chapter successfully' };
  }

  async getChapterMembers(chapterId: string, page: number = 1, limit: number = 20) {
    const { skip, take } = paginationHelper(page, limit);

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
        skip,
        take,
      }),
      prisma.chapterMembership.count({ where: { chapterId } }),
    ]);

    return buildPaginationResponse(
      members.map(m => ({ ...m.user, joinedAt: m.joinedAt })),
      total,
      page,
      limit
    );
  }

  async getUserChapters(userId: string) {
    const memberships = await prisma.chapterMembership.findMany({
      where: { userId },
      include: {
        chapter: true,
      },
    });

    return memberships.map(m => ({
      ...m.chapter,
      joinedAt: m.joinedAt,
    }));
  }

  // Admin: Assign chapter admin
  async assignAdmin(chapterId: string, adminUserId: string) {
    return prisma.chapter.update({
      where: { id: chapterId },
      data: { adminUserId },
    });
  }
}

export const chapterService = new ChapterService();
