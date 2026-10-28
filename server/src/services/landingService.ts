import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { LandingBlockType, Prisma } from '@prisma/client';

const TYPES = Object.values(LandingBlockType) as LandingBlockType[];

const assertType = (t: unknown): LandingBlockType => {
  if (!TYPES.includes(t as LandingBlockType)) throw new AppError('Invalid block type', 400, 'VALIDATION_ERROR');
  return t as LandingBlockType;
};

// config is free-form per type but must be a plain object (never an array/primitive).
const assertConfig = (c: unknown): Record<string, unknown> => {
  if (c === null || typeof c !== 'object' || Array.isArray(c)) {
    throw new AppError('Block config must be an object', 400, 'VALIDATION_ERROR');
  }
  return c as Record<string, unknown>;
};

export class LandingService {
  /** Public render reads published blocks in order; the admin editor passes publishedOnly=false. */
  async getBlocks(publishedOnly = true) {
    return prisma.landingBlock.findMany({
      where: publishedOnly ? { isPublished: true } : {},
      orderBy: { order: 'asc' },
    });
  }

  async createBlock(data: { type: unknown; config?: unknown; isPublished?: boolean }) {
    const type = assertType(data.type);
    const config = assertConfig(data.config ?? {});
    const last = await prisma.landingBlock.findFirst({ orderBy: { order: 'desc' }, select: { order: true } });
    return prisma.landingBlock.create({
      data: {
        type,
        config: config as object,
        order: (last?.order ?? -1) + 1,
        isPublished: data.isPublished !== false,
      },
    });
  }

  async updateBlock(id: string, data: { type?: unknown; config?: unknown; isPublished?: boolean }) {
    await this.findOrThrow(id);
    const update: Record<string, unknown> = {};
    if (data.type !== undefined) update.type = assertType(data.type);
    if (data.config !== undefined) update.config = assertConfig(data.config) as object;
    if (data.isPublished !== undefined) {
      if (typeof data.isPublished !== 'boolean') throw new AppError('isPublished must be a boolean', 400, 'VALIDATION_ERROR');
      update.isPublished = data.isPublished;
    }
    return prisma.landingBlock.update({ where: { id }, data: update as Prisma.LandingBlockUpdateInput });
  }

  async deleteBlock(id: string) {
    await this.findOrThrow(id);
    await prisma.landingBlock.delete({ where: { id } });
    return { message: 'Block deleted' };
  }

  /** Persist a new order from an array of block ids (index = order), atomically. */
  async reorder(ids: unknown) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new AppError('order must be an array of block ids', 400, 'VALIDATION_ERROR');
    }
    await prisma.$transaction(
      (ids as string[]).map((id, index) => prisma.landingBlock.update({ where: { id }, data: { order: index } }))
    );
    return this.getBlocks(false);
  }

  private async findOrThrow(id: string) {
    const block = await prisma.landingBlock.findUnique({ where: { id } });
    if (!block) throw new AppError('Block not found', 404, 'NOT_FOUND');
    return block;
  }
}

export const landingService = new LandingService();
