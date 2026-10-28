import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { deleteFromStorage } from '../utils/storage';
import { clientLinks } from '../utils/clientLinks';
import { broadcastNotification } from './broadcastService';
import { Prisma } from '@prisma/client';

interface MagazineInput {
  title: string;
  edition?: string;
  description?: string;
  coverImageUrl?: string;
  fileUrl: string;
}

const EDITABLE_FIELDS = ['title', 'edition', 'description', 'coverImageUrl', 'isPublished'] as const;

const uploaderSelect = { id: true, fullName: true } as const;

export class CollegeMagazineService {
  /** Public listing returns published editions; admins (passing all=true) see drafts too. */
  async getMagazines(filters: { page?: number; limit?: number; includeUnpublished?: boolean } = {}) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);
    const where: Prisma.CollegeMagazineWhereInput = filters.includeUnpublished ? {} : { isPublished: true };

    const [items, total] = await Promise.all([
      prisma.collegeMagazine.findMany({
        where,
        include: { uploadedBy: { select: uploaderSelect } },
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
      }),
      prisma.collegeMagazine.count({ where }),
    ]);
    return buildPaginationResponse(items, total, page, limit);
  }

  async getMagazine(id: string, includeUnpublished = false) {
    const magazine = await prisma.collegeMagazine.findUnique({
      where: { id },
      include: { uploadedBy: { select: uploaderSelect } },
    });
    if (!magazine || (!magazine.isPublished && !includeUnpublished)) {
      throw new AppError('Magazine not found', 404, 'NOT_FOUND');
    }
    return magazine;
  }

  async createMagazine(uploadedById: string, data: MagazineInput) {
    if (typeof data?.title !== 'string' || !data.title.trim()) {
      throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
    }
    if (typeof data?.fileUrl !== 'string' || !data.fileUrl.trim()) {
      throw new AppError('A magazine PDF is required', 400, 'VALIDATION_ERROR');
    }

    const magazine = await prisma.collegeMagazine.create({
      data: {
        title: data.title.trim().slice(0, 200),
        edition: typeof data.edition === 'string' ? data.edition.trim() : undefined,
        description: typeof data.description === 'string' ? data.description.trim() : undefined,
        coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl.trim() : undefined,
        fileUrl: data.fileUrl.trim(),
        uploadedById,
      },
    });

    if (magazine.isPublished) {
      await broadcastNotification({
        type: 'ADMIN_ANNOUNCEMENT',
        title: 'New magazine edition',
        message: `"${magazine.title}" is now available to read.`,
        link: clientLinks.magazine(),
        metadata: { magazineId: magazine.id },
        excludeUserId: uploadedById,
      });
    }
    return magazine;
  }

  async updateMagazine(id: string, data: Partial<MagazineInput> & { isPublished?: boolean }) {
    await this.findOrThrow(id);
    const updateData: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (data && (data as Record<string, unknown>)[field] !== undefined) {
        updateData[field] = (data as Record<string, unknown>)[field];
      }
    }
    if (updateData.title !== undefined) {
      if (typeof updateData.title !== 'string' || !updateData.title.trim()) {
        throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
      }
      updateData.title = (updateData.title as string).trim().slice(0, 200);
    }
    return prisma.collegeMagazine.update({ where: { id }, data: updateData as Prisma.CollegeMagazineUpdateInput });
  }

  async deleteMagazine(id: string) {
    const magazine = await this.findOrThrow(id);
    await prisma.collegeMagazine.delete({ where: { id } });
    await Promise.allSettled([
      magazine.fileUrl ? deleteFromStorage(magazine.fileUrl) : Promise.resolve(),
      magazine.coverImageUrl ? deleteFromStorage(magazine.coverImageUrl) : Promise.resolve(),
    ]);
    return { message: 'Magazine deleted' };
  }

  private async findOrThrow(id: string) {
    const magazine = await prisma.collegeMagazine.findUnique({ where: { id } });
    if (!magazine) throw new AppError('Magazine not found', 404, 'NOT_FOUND');
    return magazine;
  }
}

export const collegeMagazineService = new CollegeMagazineService();
