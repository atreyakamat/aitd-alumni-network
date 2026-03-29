import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { notificationService } from './notificationService';

interface CreateMentorProfileInput {
  focusAreas: string[];
  availability?: string;
  bio?: string;
  maxMentees?: number;
}

interface UpdateMentorProfileInput {
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
  scheduledAt: Date;
  notes?: string;
}

export class MentorshipService {
  // ============== MENTOR PROFILES ==============

  async getMentors(page: number = 1, limit: number = 20, filters: {
    focusArea?: string;
    search?: string;
    available?: boolean;
  } = {}) {
    const { skip, take } = paginationHelper(page, limit);

    const where: Record<string, unknown> = {
      isActive: true,
    };

    const [mentors, total] = await Promise.all([
      prisma.mentorProfile.findMany({
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
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.mentorProfile.count({ where }),
    ]);

    // Filter by focus area or search (post-query for JSON field)
    let filteredMentors = mentors;
    
    // Filter by availability
    if (filters.available) {
      filteredMentors = filteredMentors.filter(m => m.currentMentees < m.maxMentees);
    }
    
    if (filters.focusArea) {
      filteredMentors = filteredMentors.filter((m) => {
        const areas = m.focusAreas as string[];
        return areas.some((a) => a.toLowerCase().includes(filters.focusArea!.toLowerCase()));
      });
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filteredMentors = filteredMentors.filter((m) =>
        m.user.fullName.toLowerCase().includes(searchLower) ||
        m.bio?.toLowerCase().includes(searchLower) ||
        (m.focusAreas as string[]).some((a) => a.toLowerCase().includes(searchLower))
      );
    }

    return buildPaginationResponse(filteredMentors, total, page, limit);
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
    // Check if profile already exists
    const existing = await prisma.mentorProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      throw new AppError('Mentor profile already exists', 400, 'PROFILE_EXISTS');
    }

    const profile = await prisma.mentorProfile.create({
      data: {
        userId,
        focusAreas: data.focusAreas,
        availability: data.availability,
        bio: data.bio,
        maxMentees: data.maxMentees || 5,
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

    return profile;
  }

  async updateMentorProfile(userId: string, data: UpdateMentorProfileInput) {
    const profile = await prisma.mentorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new AppError('Mentor profile not found', 404, 'NOT_FOUND');
    }

    const updated = await prisma.mentorProfile.update({
      where: { userId },
      data: {
        ...(data.focusAreas && { focusAreas: data.focusAreas }),
        ...(data.availability !== undefined && { availability: data.availability }),
        ...(data.bio !== undefined && { bio: data.bio }),
        ...(data.maxMentees !== undefined && { maxMentees: data.maxMentees }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    return updated;
  }

  async deleteMentorProfile(userId: string) {
    const profile = await prisma.mentorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new AppError('Mentor profile not found', 404, 'NOT_FOUND');
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

    // Get mentor profile
    const mentorProfile = await prisma.mentorProfile.findUnique({
      where: { userId: mentorUserId },
      include: { user: true },
    });

    if (!mentorProfile) {
      throw new AppError('Mentor profile not found', 404, 'NOT_FOUND');
    }

    if (!mentorProfile.isActive) {
      throw new AppError('Mentor is not accepting new mentees', 400, 'MENTOR_INACTIVE');
    }

    if (mentorProfile.currentMentees >= mentorProfile.maxMentees) {
      throw new AppError('Mentor has reached maximum mentee capacity', 400, 'MENTOR_FULL');
    }

    // Check for existing pending request
    const existingRequest = await prisma.mentorshipRequest.findFirst({
      where: {
        menteeId,
        mentorId: mentorUserId,
        status: 'PENDING',
      },
    });

    if (existingRequest) {
      throw new AppError('You already have a pending request with this mentor', 400, 'REQUEST_EXISTS');
    }

    // Check for existing active mentorship
    const activeMentorship = await prisma.mentorshipRequest.findFirst({
      where: {
        menteeId,
        mentorId: mentorUserId,
        status: 'ACCEPTED',
      },
    });

    if (activeMentorship) {
      throw new AppError('You already have an active mentorship with this mentor', 400, 'MENTORSHIP_EXISTS');
    }

    const request = await prisma.mentorshipRequest.create({
      data: {
        menteeId,
        mentorId: mentorUserId,
        profileId: mentorProfile.id,
        message: data.message,
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

    // Notify mentor
    await notificationService.createNotification({
      userId: mentorUserId,
      type: 'MENTORSHIP_REQUEST',
      title: 'New Mentorship Request',
      message: `${request.mentee.fullName} has requested mentorship from you`,
      link: `/mentorship/requests`,
      metadata: { requestId: request.id },
    });

    return request;
  }

  async respondToRequest(userId: string, requestId: string, accept: boolean) {
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

    const status = accept ? 'ACCEPTED' : 'DECLINED';

    const [updatedRequest] = await prisma.$transaction([
      prisma.mentorshipRequest.update({
        where: { id: requestId },
        data: { status },
      }),
      // If accepted, increment mentee count
      ...(accept
        ? [
            prisma.mentorProfile.update({
              where: { id: request.profileId },
              data: { currentMentees: { increment: 1 } },
            }),
          ]
        : []),
    ]);

    // Notify mentee
    await notificationService.createNotification({
      userId: request.menteeId,
      type: accept ? 'MENTORSHIP_ACCEPTED' : 'MENTORSHIP_DECLINED',
      title: accept ? 'Mentorship Request Accepted' : 'Mentorship Request Declined',
      message: accept
        ? `${request.mentor.fullName} has accepted your mentorship request`
        : `${request.mentor.fullName} has declined your mentorship request`,
      link: accept ? `/mentorship` : undefined,
    });

    return updatedRequest;
  }

  async getMyMentorshipRequests(userId: string, role: 'mentor' | 'mentee', status?: string) {
    const where: Record<string, unknown> = role === 'mentor' ? { mentorId: userId } : { menteeId: userId };

    if (status) {
      where.status = status;
    }

    const requests = await prisma.mentorshipRequest.findMany({
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

    return requests;
  }

  // ============== SESSIONS ==============

  async scheduleSession(userId: string, requestId: string, data: ScheduleSessionInput) {
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

    if (request.status !== 'ACCEPTED') {
      throw new AppError('Cannot schedule session for non-accepted mentorship', 400, 'INVALID_STATUS');
    }

    if (request.mentorId !== userId && request.menteeId !== userId) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    const session = await prisma.mentorshipSession.create({
      data: {
        requestId,
        scheduledAt: new Date(data.scheduledAt),
        notes: data.notes,
      },
    });

    // Notify the other party
    const notifyUserId = userId === request.mentorId ? request.menteeId : request.mentorId;
    const schedulerName = userId === request.mentorId ? request.mentor.fullName : request.mentee.fullName;

    await notificationService.createNotification({
      userId: notifyUserId,
      type: 'MENTORSHIP_SESSION',
      title: 'Mentorship Session Scheduled',
      message: `${schedulerName} scheduled a session for ${new Date(data.scheduledAt).toLocaleDateString()}`,
      link: `/mentorship`,
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

    const updated = await prisma.mentorshipSession.update({
      where: { id: sessionId },
      data: {
        completed: true,
        outcomes,
      },
    });

    return updated;
  }

  async getMentorshipSessions(requestId: string, userId: string) {
    const request = await prisma.mentorshipRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new AppError('Mentorship not found', 404, 'NOT_FOUND');
    }

    if (request.mentorId !== userId && request.menteeId !== userId) {
      throw new AppError('Not authorized', 403, 'FORBIDDEN');
    }

    const sessions = await prisma.mentorshipSession.findMany({
      where: { requestId },
      orderBy: { scheduledAt: 'desc' },
    });

    return sessions;
  }

  // ============== END MENTORSHIP ==============

  async endMentorship(userId: string, requestId: string) {
    const request = await prisma.mentorshipRequest.findUnique({
      where: { id: requestId },
      include: {
        profile: true,
      },
    });

    if (!request) {
      throw new AppError('Mentorship not found', 404, 'NOT_FOUND');
    }

    if (request.mentorId !== userId && request.menteeId !== userId) {
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
      prisma.mentorProfile.update({
        where: { id: request.profileId },
        data: { currentMentees: { decrement: 1 } },
      }),
    ]);

    return { message: 'Mentorship ended successfully' };
  }
}

export const mentorshipService = new MentorshipService();
