import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { deleteFromStorage } from '../utils/storage';
import { Actor, isAdminRole } from '../config/permissions';
import { GalleryAlbumType, Prisma } from '@prisma/client';

interface CreateAlbumInput {
  title: string;
  description?: string;
  albumType?: GalleryAlbumType;
  batchYear?: number;
  eventId?: string;
  isPublic?: boolean;
  coverPhotoUrl?: string;
}

const ALBUM_TYPES: GalleryAlbumType[] = ['EVENT', 'BATCH', 'INSTITUTIONAL'];
const EDITABLE_ALBUM_FIELDS = ['title', 'description', 'albumType', 'batchYear', 'eventId', 'isPublic', 'coverPhotoUrl'] as const;
const MAX_RECENT_PHOTOS = 50;
const MAX_SEARCH_LENGTH = 100;

const assertAlbumType = (type: unknown): GalleryAlbumType | undefined => {
  if (type === undefined || type === null || type === '') return undefined;
  if (!ALBUM_TYPES.includes(type as GalleryAlbumType)) {
    throw new AppError('Invalid album type', 400, 'VALIDATION_ERROR');
  }
  return type as GalleryAlbumType;
};

/** Best-effort removal of stored files; storage failures never block DB cleanup. */
const removeFiles = async (urls: Array<string | null | undefined>) => {
  const unique = Array.from(new Set(urls.filter((u): u is string => !!u)));
  await Promise.all(
    unique.map(url =>
      deleteFromStorage(url).catch(err => console.warn('Failed to delete gallery file', url, err))
    )
  );
};

/**
 * Contribution rule for member uploads:
 *  - ADMIN / SUPER_ADMIN may add photos to any album.
 *  - BATCH albums accept photos from members of that batch year.
 *  - EVENT albums accept photos from members who RSVP'd to the event.
 *  - INSTITUTIONAL albums are admin-only.
 */
export class GalleryService {
  async getAlbums(page: number = 1, limit: number = 12, type?: GalleryAlbumType, search?: string) {
    const pg = paginationHelper(page, limit);

    const where: Prisma.GalleryAlbumWhereInput = {
      isPublic: true,
    };

    const albumType = assertAlbumType(type);
    if (albumType) {
      where.albumType = albumType;
    }

    const term = typeof search === 'string' ? search.trim().slice(0, MAX_SEARCH_LENGTH) : '';
    if (term) {
      where.OR = [{ title: ilike(term) }, { description: ilike(term) }];
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
        skip: pg.skip,
        take: pg.take,
      }),
      prisma.galleryAlbum.count({ where }),
    ]);

    return buildPaginationResponse(albums, total, pg.page, pg.limit);
  }

  /** Private albums are members-only: anonymous viewers get a 404. */
  async getAlbum(id: string, viewer?: Actor | null) {
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

    if (!album || (!album.isPublic && !viewer)) {
      throw new AppError('Album not found', 404, 'NOT_FOUND');
    }

    return album;
  }

  async createAlbum(data: CreateAlbumInput) {
    if (!data || typeof data.title !== 'string' || !data.title.trim()) {
      throw new AppError('Album title is required', 400, 'VALIDATION_ERROR');
    }
    const albumType = assertAlbumType(data.albumType) || 'INSTITUTIONAL';
    if (albumType === 'BATCH' && !data.batchYear) {
      throw new AppError('Batch albums require a batch year', 400, 'VALIDATION_ERROR');
    }
    if (albumType === 'EVENT' && !data.eventId) {
      throw new AppError('Event albums require an event', 400, 'VALIDATION_ERROR');
    }

    return prisma.galleryAlbum.create({
      data: {
        title: data.title.trim(),
        description: data.description,
        albumType,
        batchYear: data.batchYear !== undefined ? Number(data.batchYear) : undefined,
        eventId: data.eventId,
        isPublic: data.isPublic ?? true,
      },
    });
  }

  async updateAlbum(id: string, data: Partial<CreateAlbumInput>) {
    const album = await prisma.galleryAlbum.findUnique({ where: { id } });
    if (!album) {
      throw new AppError('Album not found', 404, 'NOT_FOUND');
    }

    const updates: Record<string, unknown> = {};
    for (const field of EDITABLE_ALBUM_FIELDS) {
      if (data && data[field] !== undefined) updates[field] = data[field];
    }
    if (updates.albumType !== undefined) assertAlbumType(updates.albumType);
    if (updates.title !== undefined && (typeof updates.title !== 'string' || !updates.title.trim())) {
      throw new AppError('Album title is required', 400, 'VALIDATION_ERROR');
    }

    return prisma.galleryAlbum.update({
      where: { id },
      data: updates as Prisma.GalleryAlbumUpdateInput,
    });
  }

  /** Deletes the album, its photo rows and (best effort) the stored files. */
  async deleteAlbum(id: string) {
    const album = await prisma.galleryAlbum.findUnique({
      where: { id },
      include: { photos: { select: { url: true, thumbnailUrl: true } } },
    });
    if (!album) {
      throw new AppError('Album not found', 404, 'NOT_FOUND');
    }

    await prisma.$transaction([
      prisma.galleryPhoto.deleteMany({ where: { albumId: id } }),
      prisma.galleryAlbum.delete({ where: { id } }),
    ]);

    const photos = (album as any).photos as Array<{ url: string; thumbnailUrl: string | null }>;
    await removeFiles(photos.flatMap(p => [p.url, p.thumbnailUrl]));

    return { message: 'Album deleted', photosDeleted: photos.length };
  }

  /** Throws unless `actor` may contribute photos to the album. Returns the album. */
  async assertCanAddPhoto(albumId: string, actor: Actor) {
    const album = await prisma.galleryAlbum.findUnique({
      where: { id: albumId },
    });

    if (!album) {
      throw new AppError('Album not found', 404, 'NOT_FOUND');
    }

    if (isAdminRole(actor.userRole)) return album;

    const forbidden = () =>
      new AppError('You cannot add photos to this album', 403, 'FORBIDDEN');

    if (album.albumType === 'BATCH') {
      const user = await prisma.user.findUnique({
        where: { id: actor.id },
        select: { batchYear: true },
      });
      if (!user || album.batchYear === null || user.batchYear !== album.batchYear) throw forbidden();
      return album;
    }

    if (album.albumType === 'EVENT') {
      if (!album.eventId) throw forbidden();
      const rsvp = await prisma.eventRSVP.findUnique({
        where: { eventId_userId: { eventId: album.eventId, userId: actor.id } },
      });
      if (!rsvp) throw forbidden();
      return album;
    }

    throw forbidden();
  }

  async addPhoto(albumId: string, actor: Actor, url: string, thumbnailUrl?: string, caption?: string) {
    if (!albumId) {
      throw new AppError('Album is required', 400, 'VALIDATION_ERROR');
    }
    if (!url || typeof url !== 'string') {
      throw new AppError('Photo URL is required', 400, 'VALIDATION_ERROR');
    }

    const album = await this.assertCanAddPhoto(albumId, actor);

    return prisma.$transaction(async tx => {
      const photo = await tx.galleryPhoto.create({
        data: {
          albumId,
          url,
          thumbnailUrl,
          caption,
          uploadedById: actor.id,
        },
      });

      // Update album photo count and cover if not set
      await tx.galleryAlbum.update({
        where: { id: albumId },
        data: {
          photoCount: { increment: 1 },
          coverPhotoUrl: album.coverPhotoUrl || url,
        },
      });

      return photo;
    });
  }

  /**
   * Delete a photo. Without an actor the caller is trusted (admin route);
   * with an actor only the uploader or a platform admin may delete.
   */
  async deletePhoto(photoId: string, actor?: Actor) {
    const photo = await prisma.galleryPhoto.findUnique({
      where: { id: photoId },
      include: { album: { select: { id: true, coverPhotoUrl: true } } },
    });

    if (!photo) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    if (actor && photo.uploadedById !== actor.id && !isAdminRole(actor.userRole)) {
      throw new AppError('Not authorized to delete this photo', 403, 'FORBIDDEN');
    }

    await prisma.$transaction(async tx => {
      await tx.galleryPhoto.delete({ where: { id: photoId } });

      // Decrement photo count, never below zero
      await tx.galleryAlbum.updateMany({
        where: { id: photo.albumId, photoCount: { gt: 0 } },
        data: { photoCount: { decrement: 1 } },
      });

      // If this photo was the cover, fall back to the newest remaining photo
      const album = (photo as any).album as { coverPhotoUrl: string | null } | null;
      if (album && album.coverPhotoUrl === photo.url) {
        const next = await tx.galleryPhoto.findFirst({
          where: { albumId: photo.albumId },
          orderBy: { createdAt: 'desc' },
          select: { url: true },
        });
        await tx.galleryAlbum.update({
          where: { id: photo.albumId },
          data: { coverPhotoUrl: next?.url ?? null },
        });
      }
    });

    await removeFiles([photo.url, photo.thumbnailUrl]);

    return { message: 'Photo deleted' };
  }

  // Users can delete their own photos; admins can delete any
  async userDeletePhoto(photoId: string, actor: Actor) {
    return this.deletePhoto(photoId, actor);
  }

  async getRecentPhotos(limit: number = 8) {
    const take = Number.isFinite(limit) ? Math.min(MAX_RECENT_PHOTOS, Math.max(1, Math.floor(limit))) : 8;
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
      take,
    });
  }
}

export const galleryService = new GalleryService();
