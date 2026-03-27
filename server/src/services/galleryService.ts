import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { GalleryAlbumType, Prisma } from '@prisma/client';

interface CreateAlbumInput {
  title: string;
  description?: string;
  albumType?: GalleryAlbumType;
  batchYear?: number;
  eventId?: string;
  isPublic?: boolean;
}

export class GalleryService {
  async getAlbums(page: number = 1, limit: number = 12, type?: GalleryAlbumType) {
    const { skip, take } = paginationHelper(page, limit);

    const where: Prisma.GalleryAlbumWhereInput = {
      isPublic: true,
    };

    if (type) {
      where.albumType = type;
    }

    const [albums, total] = await Promise.all([
      prisma.galleryAlbum.findMany({
        where,
        include: {
          event: {
            select: { id: true, title: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.galleryAlbum.count({ where }),
    ]);

    return buildPaginationResponse(albums, total, page, limit);
  }

  async getAlbum(id: string) {
    const album = await prisma.galleryAlbum.findUnique({
      where: { id },
      include: {
        event: true,
        photos: {
          include: {
            uploadedBy: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!album) {
      throw new AppError('Album not found', 404, 'NOT_FOUND');
    }

    return album;
  }

  async createAlbum(data: CreateAlbumInput) {
    return prisma.galleryAlbum.create({
      data: {
        title: data.title,
        description: data.description,
        albumType: data.albumType || 'INSTITUTIONAL',
        batchYear: data.batchYear,
        eventId: data.eventId,
        isPublic: data.isPublic ?? true,
      },
    });
  }

  async updateAlbum(id: string, data: Partial<CreateAlbumInput>) {
    return prisma.galleryAlbum.update({
      where: { id },
      data,
    });
  }

  async deleteAlbum(id: string) {
    await prisma.galleryAlbum.delete({ where: { id } });
    return { message: 'Album deleted' };
  }

  async addPhoto(albumId: string, userId: string, url: string, thumbnailUrl?: string, caption?: string) {
    const album = await prisma.galleryAlbum.findUnique({
      where: { id: albumId },
    });

    if (!album) {
      throw new AppError('Album not found', 404, 'NOT_FOUND');
    }

    const photo = await prisma.galleryPhoto.create({
      data: {
        albumId,
        url,
        thumbnailUrl,
        caption,
        uploadedById: userId,
      },
    });

    // Update album photo count and cover if not set
    await prisma.galleryAlbum.update({
      where: { id: albumId },
      data: {
        photoCount: { increment: 1 },
        coverPhotoUrl: album.coverPhotoUrl || url,
      },
    });

    return photo;
  }

  async deletePhoto(photoId: string) {
    const photo = await prisma.galleryPhoto.findUnique({
      where: { id: photoId },
    });

    if (!photo) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    await prisma.galleryPhoto.delete({ where: { id: photoId } });

    // Decrement photo count
    await prisma.galleryAlbum.update({
      where: { id: photo.albumId },
      data: { photoCount: { decrement: 1 } },
    });

    return { message: 'Photo deleted' };
  }

  async getRecentPhotos(limit: number = 8) {
    return prisma.galleryPhoto.findMany({
      where: {
        album: { isPublic: true },
      },
      include: {
        album: {
          select: { id: true, title: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const galleryService = new GalleryService();
