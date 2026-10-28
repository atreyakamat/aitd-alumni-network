import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { Actor, isAdminRole } from '../config/permissions';
import { deleteFromStorage } from '../utils/storage';
import { clientLinks } from '../utils/clientLinks';
import { notificationService } from './notificationService';
import { broadcastNotification } from './broadcastService';
import { VideoStatus, Prisma } from '@prisma/client';

interface VideoInput {
  title: string;
  description?: string;
  videoUrl: string;
  thumbnailUrl?: string;
  category?: string;
}

interface VideoFilters {
  status?: string;
  category?: string;
  search?: string;
  page?: number;
  limit?: number;
}

const STATUSES: VideoStatus[] = ['PENDING', 'APPROVED', 'REJECTED'];
const EDITABLE_FIELDS = ['title', 'description', 'category', 'thumbnailUrl'] as const;
const MAX_SEARCH_LENGTH = 100;
const TITLE_MAX = 200;

const submitterSelect = {
  id: true,
  fullName: true,
  profilePhotoUrl: true,
} as const;

const requireTitle = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('Title is required', 400, 'VALIDATION_ERROR');
  }
  return value.trim().slice(0, TITLE_MAX);
};

export class CollegeVideoService {
  /**
   * Public listing returns APPROVED videos only. Platform admins may pass a
   * `status` filter to review the PENDING/REJECTED queues.
   */
  async getVideos(filters: VideoFilters = {}, viewer?: Actor | null) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);
    const isAdmin = !!viewer && isAdminRole(viewer.userRole);

    let status: VideoStatus = 'APPROVED';
    if (isAdmin && filters.status) {
      if (!STATUSES.includes(filters.status as VideoStatus)) {
        throw new AppError('Invalid video status', 400, 'VALIDATION_ERROR');
      }
      status = filters.status as VideoStatus;
    }

    const where: Prisma.CollegeVideoWhereInput = { status };
    if (filters.category && typeof filters.category === 'string') {
      where.category = filters.category.trim();
    }
    const search = typeof filters.search === 'string' ? filters.search.trim().slice(0, MAX_SEARCH_LENGTH) : '';
    if (search) {
      where.OR = [{ title: ilike(search) }, { description: ilike(search) }];
    }

    const [videos, total] = await Promise.all([
      prisma.collegeVideo.findMany({
        where,
        include: { submittedBy: { select: submitterSelect } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.collegeVideo.count({ where }),
    ]);

    return buildPaginationResponse(videos, total, page, limit);
  }

  /** A member's own submissions, any status. */
  async getMySubmissions(userId: string, filters: VideoFilters = {}) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);
    const where: Prisma.CollegeVideoWhereInput = { submittedById: userId };

    const [videos, total] = await Promise.all([
      prisma.collegeVideo.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.collegeVideo.count({ where }),
    ]);
    return buildPaginationResponse(videos, total, page, limit);
  }

  /**
   * APPROVED videos are visible to everyone; PENDING/REJECTED only to an admin
   * or the member who submitted it. Viewing an approved video counts a view.
   */
  async getVideo(id: string, viewer?: Actor | null) {
    const video = await prisma.collegeVideo.findUnique({
      where: { id },
      include: { submittedBy: { select: submitterSelect } },
    });
    if (!video) throw new AppError('Video not found', 404, 'NOT_FOUND');

    const isAdmin = !!viewer && isAdminRole(viewer.userRole);
    const isOwner = !!viewer && viewer.id === video.submittedById;
    if (video.status !== 'APPROVED' && !isAdmin && !isOwner) {
      throw new AppError('Video not found', 404, 'NOT_FOUND');
    }

    if (video.status === 'APPROVED') {
      await prisma.collegeVideo.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      return { ...video, viewCount: (video.viewCount ?? 0) + 1 };
    }
    return video;
  }

  private validateInput(data: VideoInput) {
    const title = requireTitle(data?.title);
    if (typeof data?.videoUrl !== 'string' || !data.videoUrl.trim()) {
      throw new AppError('A video file is required', 400, 'VALIDATION_ERROR');
    }
    return {
      title,
      videoUrl: data.videoUrl.trim(),
      description: typeof data.description === 'string' ? data.description.trim() : undefined,
      thumbnailUrl: typeof data.thumbnailUrl === 'string' ? data.thumbnailUrl.trim() : undefined,
      category: typeof data.category === 'string' && data.category.trim() ? data.category.trim() : undefined,
    };
  }

  /**
   * Create a video. An admin's upload is APPROVED immediately (and broadcast to the
   * community); a member's submission enters as PENDING for admin review.
   */
  async createVideo(actor: Actor, data: VideoInput) {
    const clean = this.validateInput(data);
    const isAdmin = isAdminRole(actor.userRole);

    const video = await prisma.collegeVideo.create({
      data: {
        ...clean,
        submittedById: actor.id,
        status: isAdmin ? 'APPROVED' : 'PENDING',
        reviewedById: isAdmin ? actor.id : null,
        reviewedAt: isAdmin ? new Date() : null,
      },
    });

    if (isAdmin) {
      await this.announce(video.id, video.title, actor.id);
    } else {
      await this.notifyAdmins(video.title);
    }
    return video;
  }

  async approveVideo(adminId: string, id: string) {
    const video = await prisma.collegeVideo.findUnique({ where: { id } });
    if (!video) throw new AppError('Video not found', 404, 'NOT_FOUND');
    if (video.status === 'APPROVED') return video;

    const updated = await prisma.collegeVideo.update({
      where: { id },
      data: { status: 'APPROVED', reviewedById: adminId, reviewedAt: new Date(), rejectionReason: null },
    });

    // Tell the submitter, then broadcast to the community.
    await notificationService.createNotification({
      userId: video.submittedById,
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'Your video was published',
      message: `"${video.title}" is now live on the Videos page.`,
      link: clientLinks.videos(),
      metadata: { videoId: id },
    });
    await this.announce(id, video.title, adminId);
    return updated;
  }

  async rejectVideo(adminId: string, id: string, reason?: string) {
    const video = await prisma.collegeVideo.findUnique({ where: { id } });
    if (!video) throw new AppError('Video not found', 404, 'NOT_FOUND');

    const updated = await prisma.collegeVideo.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: typeof reason === 'string' ? reason.trim().slice(0, 500) || null : null,
      },
    });

    await notificationService.createNotification({
      userId: video.submittedById,
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'Your video submission was not approved',
      message: updated.rejectionReason
        ? `"${video.title}" was not approved: ${updated.rejectionReason}`
        : `"${video.title}" was not approved.`,
      metadata: { videoId: id },
    });
    return updated;
  }

  async updateVideo(id: string, data: Partial<VideoInput>) {
    await this.findOrThrow(id);
    const updateData: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (data && data[field] !== undefined) updateData[field] = data[field];
    }
    if (updateData.title !== undefined) updateData.title = requireTitle(updateData.title);
    return prisma.collegeVideo.update({ where: { id }, data: updateData as Prisma.CollegeVideoUpdateInput });
  }

  /** Admins may delete any video; a submitter may delete their own while still PENDING. */
  async deleteVideo(actor: Actor, id: string) {
    const video = await this.findOrThrow(id);
    const isAdmin = isAdminRole(actor.userRole);
    const isOwner = actor.id === video.submittedById;
    if (!isAdmin && !(isOwner && video.status === 'PENDING')) {
      throw new AppError('Not authorized to delete this video', 403, 'FORBIDDEN');
    }

    await prisma.collegeVideo.delete({ where: { id } });
    // Best-effort cleanup of the stored media; a storage failure must not fail the delete.
    await Promise.allSettled([
      video.videoUrl ? deleteFromStorage(video.videoUrl) : Promise.resolve(),
      video.thumbnailUrl ? deleteFromStorage(video.thumbnailUrl) : Promise.resolve(),
    ]);
    return { message: 'Video deleted' };
  }

  private async findOrThrow(id: string) {
    const video = await prisma.collegeVideo.findUnique({ where: { id } });
    if (!video) throw new AppError('Video not found', 404, 'NOT_FOUND');
    return video;
  }

  /** Broadcast a newly published video to the whole community (excluding the publisher). */
  private async announce(videoId: string, title: string, excludeUserId: string) {
    await broadcastNotification({
      type: 'ADMIN_ANNOUNCEMENT',
      title: 'New video published',
      message: `"${title}" was just added to the college Videos.`,
      link: clientLinks.videos(),
      metadata: { videoId },
      excludeUserId,
    });
  }

  /** Let admins know a member submitted a video for review (few admins -> simple loop). */
  private async notifyAdmins(title: string) {
    const admins = await prisma.user.findMany({
      where: { isActive: true, userRole: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        notificationService.createNotification({
          userId: a.id,
          type: 'ADMIN_ANNOUNCEMENT',
          title: 'New video submission',
          message: `A member submitted "${title}" for review.`,
          link: clientLinks.adminVideos(),
        })
      )
    );
  }
}

export const collegeVideoService = new CollegeVideoService();
