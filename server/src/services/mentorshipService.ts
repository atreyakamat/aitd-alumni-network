import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { notificationService } from './notificationService';
import { clientLinks } from '../utils/clientLinks';

export interface CreateMentorProfileInput {
  focusAreas: string[];
  availability?: string;
  bio?: string;
  maxMentees?: number;
}

export interface UpdateMentorProfileInput {
  focusAreas?: string[];
  availability?: string;
  bio?: string;
  maxMentees?: number;
  isActive?: boolean;
}

interface RequestMentorshipInput {
  message?: string;
}

interface ScheduleSessionInput {
  scheduledAt: Date | string;
  notes?: string;
}

export const MIN_MENTEES = 1;
export const MAX_MENTEES = 20;
export const DEFAULT_MAX_MENTEES = 5;
export const MAX_FOCUS_AREAS = 10;
export const REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'COMPLETED'] as const;

const badRequest = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

const normalizeFocusAreas = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    throw badRequest('focusAreas must be an array of strings');
  }
  if (value.some((a) => typeof a !== 'string')) {
    throw badRequest('focusAreas must be an array of strings');
  }
  const seen = new Set<string>();
  const areas: string[] = [];
  for (const raw of value as string[]) {
    const area = raw.trim();
    if (area && !seen.has(area.toLowerCase())) {
      seen.add(area.toLowerCase());
      areas.push(area);
    }
  }
  if (areas.length === 0) {
    throw badRequest('At least one focus area is required');
  }
  if (areas.length > MAX_FOCUS_AREAS) {
    throw badRequest(`At most ${MAX_FOCUS_AREAS} focus areas are allowed`);
  }
  return areas;
};

const validateMaxMentees = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_MENTEES || value > MAX_MENTEES) {
    throw badRequest(`maxMentees must be an integer between ${MIN_MENTEES} and ${MAX_MENTEES}`);
  }
  return value;
};

const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  return value;
};

const notifySafely = async (payload: Parameters<typeof notificationService.createNotification>[0]) => {
  try {
    await notificationService.createNotification(payload);
  } catch (err) {
    console.error('Mentorship notification failed:', err);
  }
};

const isParticipant = (request: { mentorId: string; menteeId: string }, userId: string) =>
  request.mentorId === userId || request.menteeId === userId;

export class MentorshipService {
  // ============== MENTOR PROFILES ==============

  /**
   * Active mentors. Focus-area / free-text / availability filters can't be
   * expressed in SQL (JSON array + column comparison), so when any of them is
   * used we filter the full active set in memory and paginate afterwards to
   * keep `total` correct.
   */
  async getMentors(page: number = 1, limit: number = 20, filters: {
    focusArea?: string;
    search?: string;
    available?: boolean;
  } = {}) {
    const { skip, take, page: safePage, limit: safeLimit } = paginationHelper(page, limit);

    const where = {
      isActive: true,
      user: { isActive: true },
    };

    const query = {
      where,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
            shortBio: true,
            batchYear: true,
            department: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' as const },
    };

    const focusArea = filters.focusArea?.trim().toLowerCase();
    const search = filters.search?.trim().toLowerCase();
    const needsPostFilter = !!(focusArea || search || filters.available);

    if (!needsPostFilter) {
      const [mentors, total] = await Promise.all([
        prisma.mentorProfile.findMany({ ...query, skip, take }),
        prisma.mentorProfile.count({ where }),
      ]);
      return buildPaginationResponse(mentors, total, safePage, safeLimit);
    }

    const all = await prisma.mentorProfile.findMany(query);
    const areasOf = (m: { focusAreas: unknown }) =>
      (Array.isArray(m.focusAreas) ? m.focusAreas : []).filter((a): a is string => typeof a === 'string');

    const filtered = all.filter((m) => {
      if (filters.available && m.currentMentees >= m.maxMentees) return false;
      if (focusArea && !areasOf(m).some((a) => a.toLowerCase().includes(focusArea))) return false;
      if (search) {
        const hit =
          m.user.fullName.toLowerCase().includes(search) ||
          (m.bio ?? '').toLowerCase().includes(search) ||
          areasOf(m).some((a) => a.toLowerCase().includes(search));
        if (!hit) return false;
      }
      return true;
    });

    return buildPaginationResponse(filtered.slice(skip, skip + take), filtered.length, safePage, safeLimit);
  }

  async getMentorProfile(userId: string) {
    const profile = await prisma.mentorProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
            shortBio: true,
            batchYear: true,
            department: true,
            linkedinUrl: true,
          },
        },
        requests: {
          where: { status: 'ACCEPTED' },
          include: {
            mentee: {
              select: {
                id: true,
                fullName: true,
                profilePhotoUrl: true,
                batchYear: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!profile) {
      throw new AppError('Mentor profile not found', 404, 'NOT_FOUND');
    }

    return profile;
  }

  async createMentorProfile(userId: string, data: CreateMentorProfileInput) {
    const input = data || ({} as CreateMentorProfileInput);
    const focusAreas = normalizeFocusAreas(input.focusAreas);
    const maxMentees = input.maxMentees === undefined || input.maxMentees === null
      ? DEFAULT_MAX_MENTEES
      : validateMaxMentees(input.maxMentees);
    const availability = optionalString(input.availability, 'availability');
    const bio = optionalString(input.bio, 'bio');

    const existing = await prisma.mentorProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new AppError('Mentor profile already exists', 409, 'PROFILE_EXISTS');
    }

    return prisma.mentorProfile.create({
      data: {
        userId,
        focusAreas,
        availability,
        bio,
        maxMentees,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
      },
    });
  }

  async updateMentorProfile(userId: string, data: UpdateMentorProfileInput) {
    const input = data || {};
    const update: Record<string, unknown> = {};

    if (input.focusAreas !== undefined) update.focusAreas = normalizeFocusAreas(input.focusAreas);
    if (input.availability !== undefined) update.availability = optionalString(input.availability, 'availability') ?? null;
    if (input.bio !== undefined) update.bio = optionalString(input.bio, 'bio') ?? null;
    if (input.maxMentees !== undefined) update.maxMentees = validateMaxMentees(input.maxMentees);
    if (input.isActive !== undefined) {
      if (typeof input.isActive !== 'boolean') throw badRequest('isActive must be a boolean');
      update.isActive = input.isActive;
    }

    const profile = await prisma.mentorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new AppError('Mentor profile not found', 404, 'NOT_FOUND');
    }

    if (Object.keys(update).length === 0) {
      throw badRequest('No valid fields to update');
    }

    return prisma.mentorProfile.update({
      where: { userId },
      data: update,
    });
  }

  /**
   * Deleting a profile cascades to its requests and sessions, so it is refused
   * while mentorships are still active (deactivate the profile instead).
   */
  async deleteMentorProfile(userId: string) {
    const profile = await prisma.mentorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new AppError('Mentor profile not found', 404, 'NOT_FOUND');
    }

    if (profile.currentMentees > 0) {
      throw new AppError(
        'End your active mentorships (or deactivate your profile) before deleting it',
        409,
        'ACTIVE_MENTORSHIPS'
      );
    }

    await prisma.mentorProfile.delete({
      where: { userId },
    });

    return { message: 'Mentor profile deleted successfully' };
  }

  // ============== MENTORSHIP REQUESTS ==============

  async requestMentorship(menteeId: string, mentorUserId: string, data: RequestMentorshipInput) {
    if (menteeId === mentorUserId) {
      throw new AppError('Cannot request mentorship from yourself', 400, 'INVALID_REQUEST');
    }

    const message = optionalString(data?.message, 'message')?.trim().slice(0, 2000) || undefined;

    const mentorProfile = await prisma.mentorProfile.findUnique({
      where: { userId: mentorUserId },
      include: { user: { select: { id: true, fullName: true, isActive: true } } },
    });

    if (!mentorProfile || mentorProfile.user?.isActive === false) {
      throw new AppError('Mentor profile not found', 404, 'NOT_FOUND');
    }

    if (!mentorProfile.isActive) {
      throw new AppError('Mentor is not accepting new mentees', 400, 'MENTOR_INACTIVE');
    }

    if (mentorProfile.currentMentees >= mentorProfile.maxMentees) {
      throw new AppError('Mentor has reached maximum mentee capacity', 400, 'MENTOR_FULL');
    }

    const existing = await prisma.mentorshipRequest.findFirst({
      where: {
        menteeId,
        mentorId: mentorUserId,
        status: { in: ['PENDING', 'ACCEPTED'] },
      },
    });

    if (existing?.status === 'PENDING') {
      throw new AppError('You already have a pending request with this mentor', 409, 'REQUEST_EXISTS');
    }
    if (existing) {
      throw new AppError('You already have an active mentorship with this mentor', 409, 'MENTORSHIP_EXISTS');
    }

    const request = await prisma.mentorshipRequest.create({
      data: {
        menteeId,
        mentorId: mentorUserId,
        profileId: mentorProfile.id,
        message,
      },
      include: {
        mentee: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            batchYear: true,
          },
        },
        mentor: {
          select: {
            id: true,
            fullName: true,
          },
        },
      },
    });

    await notifySafely({
      userId: mentorUserId,
      type: 'MENTORSHIP_REQUEST',
      title: 'New Mentorship Request',
      message: `${request.mentee.fullName} has requested mentorship from you`,
      link: clientLinks.mentorship(),
      metadata: { requestId: request.id },
    });

    return request;
  }

  async respondToRequest(userId: string, requestId: string, accept: boolean) {
    if (typeof accept !== 'boolean') {
      throw badRequest('accept must be a boolean');
    }

    const request = await prisma.mentorshipRequest.findUnique({
      where: { id: requestId },
      include: {
        mentee: { select: { id: true, fullName: true } },
        mentor: { select: { id: true, fullName: true } },
        profile: true,
      },
    });

    if (!request) {
      throw new AppError('Request not found', 404, 'NOT_FOUND');
    }

    if (request.mentorId !== userId) {
      throw new AppError('Not authorized to respond to this request', 403, 'FORBIDDEN');
    }

    if (request.status !== 'PENDING') {
      throw new AppError('Request has already been processed', 400, 'ALREADY_PROCESSED');
    }

    if (accept && request.profile && request.profile.currentMentees >= request.profile.maxMentees) {
      throw new AppError('You have reached your maximum mentee capacity', 400, 'MENTOR_FULL');
    }

    const status = accept ? 'ACCEPTED' : 'DECLINED';

    const [updatedRequest] = await prisma.$transaction([
      prisma.mentorshipRequest.update({
        where: { id: requestId },
        data: { status },
      }),
      ...(accept
        ? [
            prisma.mentorProfile.update({
              where: { id: request.profileId },
              data: { currentMentees: { increment: 1 } },
            }),
          ]
        : []),
    ]);

    await notifySafely({
      userId: request.menteeId,
      type: accept ? 'MENTORSHIP_ACCEPTED' : 'MENTORSHIP_DECLINED',
      title: accept ? 'Mentorship Request Accepted' : 'Mentorship Request Declined',
      message: accept
        ? `${request.mentor.fullName} has accepted your mentorship request`
        : `${request.mentor.fullName} has declined your mentorship request`,
      link: accept ? clientLinks.mentorship() : undefined,
    });

    return updatedRequest;
  }

  async getMyMentorshipRequests(userId: string, role: 'mentor' | 'mentee', status?: string) {
    const where: Record<string, unknown> = role === 'mentor' ? { mentorId: userId } : { menteeId: userId };

    if (status) {
      const normalized = status.toUpperCase();
      if (!(REQUEST_STATUSES as readonly string[]).includes(normalized)) {
        throw badRequest('Invalid status filter');
      }
      where.status = normalized;
    }

    return prisma.mentorshipRequest.findMany({
      where,
      include: {
        mentee: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            batchYear: true,
            department: true,
          },
        },
        mentor: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
          },
        },
        profile: {
          select: {
            focusAreas: true,
          },
        },
        sessions: {
          orderBy: { scheduledAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ============== SESSIONS ==============

  async scheduleSession(userId: string, requestId: string, data: ScheduleSessionInput) {
    const scheduledAt = data?.scheduledAt ? new Date(data.scheduledAt) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      throw badRequest('scheduledAt must be a valid date');
    }
    if (scheduledAt.getTime() <= Date.now()) {
      throw badRequest('scheduledAt must be in the future');
    }
    const notes = optionalString(data.notes, 'notes');

    const request = await prisma.mentorshipRequest.findUnique({
      where: { id: requestId },
      include: {
        mentee: { select: { id: true, fullName: true } },
        mentor: { select: { id: true, fullName: true } },
      },
    });

    if (!request) {
      throw new AppError('Mentorship request not found', 404, 'NOT_FOUND');
    }

    if (!isParticipant(request, userId)) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    if (request.status !== 'ACCEPTED') {
      throw new AppError('Cannot schedule session for non-accepted mentorship', 400, 'INVALID_STATUS');
    }

    const session = await prisma.mentorshipSession.create({
      data: {
        requestId,
        scheduledAt,
        notes,
      },
    });

    const notifyUserId = userId === request.mentorId ? request.menteeId : request.mentorId;
    const schedulerName = userId === request.mentorId ? request.mentor.fullName : request.mentee.fullName;

    await notifySafely({
      userId: notifyUserId,
      type: 'MENTORSHIP_SESSION',
      title: 'Mentorship Session Scheduled',
      message: `${schedulerName} scheduled a session for ${scheduledAt.toLocaleDateString()}`,
      link: clientLinks.mentorship(),
    });

    return session;
  }

  async completeSession(userId: string, sessionId: string, outcomes?: string) {
    const session = await prisma.mentorshipSession.findUnique({
      where: { id: sessionId },
      include: {
        request: true,
      },
    });

    if (!session) {
      throw new AppError('Session not found', 404, 'NOT_FOUND');
    }

    if (session.request.mentorId !== userId) {
      throw new AppError('Only mentors can mark sessions as complete', 403, 'FORBIDDEN');
    }

    if (session.completed) {
      throw new AppError('Session is already completed', 400, 'ALREADY_COMPLETED');
    }

    return prisma.mentorshipSession.update({
      where: { id: sessionId },
      data: {
        completed: true,
        outcomes: optionalString(outcomes, 'outcomes'),
      },
    });
  }

  async getMentorshipSessions(requestId: string, userId: string) {
    const request = await prisma.mentorshipRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new AppError('Mentorship not found', 404, 'NOT_FOUND');
    }

    if (!isParticipant(request, userId)) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    return prisma.mentorshipSession.findMany({
      where: { requestId },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  // ============== END MENTORSHIP ==============

  async endMentorship(userId: string, requestId: string) {
    const request = await prisma.mentorshipRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new AppError('Mentorship not found', 404, 'NOT_FOUND');
    }

    if (!isParticipant(request, userId)) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    if (request.status !== 'ACCEPTED') {
      throw new AppError('Mentorship is not active', 400, 'INVALID_STATUS');
    }

    await prisma.$transaction([
      prisma.mentorshipRequest.update({
        where: { id: requestId },
        data: { status: 'COMPLETED' },
      }),
      // Guarded decrement: currentMentees never drops below zero
      prisma.mentorProfile.updateMany({
        where: { id: request.profileId, currentMentees: { gt: 0 } },
        data: { currentMentees: { decrement: 1 } },
      }),
    ]);

    return { message: 'Mentorship ended successfully' };
  }
}

export const mentorshipService = new MentorshipService();
