import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { EventType, EventStatus, Prisma } from '@prisma/client';

interface CreateEventInput {
  title: string;
  description: string;
  bannerUrl?: string;
  eventType?: EventType;
  venue?: string;
  address?: string;
  city?: string;
  joinLink?: string;
  startDate: Date | string;
  endDate?: Date | string;
  capacity?: number;
  tags?: string[];
  isPublic?: boolean;
  chapterId?: string;
}

interface EventFilters {
  eventType?: EventType;
  city?: string;
  chapterId?: string;
  upcoming?: boolean;
  page?: number;
  limit?: number;
}

export class EventService {
  async getEvents(filters: EventFilters) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    const where: Prisma.EventWhereInput = {
      status: 'PUBLISHED',
      isPublic: true,
    };

    if (filters.eventType) {
      where.eventType = filters.eventType;
    }

    if (filters.city) {
      where.city = { contains: filters.city };
    }

    if (filters.chapterId) {
      where.chapterId = filters.chapterId;
    }

    if (filters.upcoming) {
      where.startDate = { gte: new Date() };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        include: {
          chapter: {
            select: { id: true, name: true },
          },
          createdBy: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
            },
          },
          _count: {
            select: { rsvps: true },
          },
        },
        orderBy: { startDate: 'asc' },
        skip,
        take,
      }),
      prisma.event.count({ where }),
    ]);

    return buildPaginationResponse(events, total, page, limit);
  }

  async getEvent(id: string, userId?: string) {
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        chapter: true,
        createdBy: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
        rsvps: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                profilePhotoUrl: true,
                currentDesignation: true,
              },
            },
          },
        },
        galleryAlbums: {
          select: {
            id: true,
            title: true,
            coverPhotoUrl: true,
            photoCount: true,
          },
        },
      },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    let hasRsvped = false;
    if (userId) {
      const rsvp = await prisma.eventRSVP.findUnique({
        where: { eventId_userId: { eventId: id, userId } },
      });
      hasRsvped = !!rsvp;
    }

    return { ...event, hasRsvped };
  }

  async createEvent(userId: string, data: CreateEventInput) {
    const event = await prisma.event.create({
      data: {
        title: data.title,
        description: data.description,
        bannerUrl: data.bannerUrl,
        eventType: data.eventType || 'OFFLINE',
        venue: data.venue,
        address: data.address,
        city: data.city,
        joinLink: data.joinLink,
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : null,
        capacity: data.capacity,
        tags: data.tags || [],
        isPublic: data.isPublic ?? true,
        chapterId: data.chapterId,
        createdById: userId,
        status: 'PUBLISHED',
      },
    });

    return event;
  }

  async updateEvent(userId: string, eventId: string, data: Partial<CreateEventInput>, isAdmin: boolean = false) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (event.createdById !== userId && !isAdmin) {
      throw new AppError('Not authorized to update this event', 403, 'FORBIDDEN');
    }

    return prisma.event.update({
      where: { id: eventId },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    });
  }

  async deleteEvent(userId: string, eventId: string, isAdmin: boolean = false) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (event.createdById !== userId && !isAdmin) {
      throw new AppError('Not authorized to delete this event', 403, 'FORBIDDEN');
    }

    await prisma.event.delete({ where: { id: eventId } });
    return { message: 'Event deleted successfully' };
  }

  async rsvpEvent(userId: string, eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (event.status !== 'PUBLISHED') {
      throw new AppError('Event is not available for RSVP', 400, 'EVENT_NOT_AVAILABLE');
    }

    const existingRsvp = await prisma.eventRSVP.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });

    if (existingRsvp) {
      // Cancel RSVP
      await prisma.eventRSVP.delete({
        where: { id: existingRsvp.id },
      });

      await prisma.event.update({
        where: { id: eventId },
        data: { rsvpCount: { decrement: 1 } },
      });

      return { rsvped: false, rsvpCount: event.rsvpCount - 1 };
    }

    // Check capacity
    if (event.capacity && event.rsvpCount >= event.capacity) {
      throw new AppError('Event is at full capacity', 400, 'EVENT_FULL');
    }

    // Create RSVP
    await prisma.eventRSVP.create({
      data: { eventId, userId },
    });

    await prisma.event.update({
      where: { id: eventId },
      data: { rsvpCount: { increment: 1 } },
    });

    // Notify event creator
    if (event.createdById !== userId) {
      const rsvpUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });

      await prisma.notification.create({
        data: {
          userId: event.createdById,
          type: 'EVENT_RSVP',
          title: 'New RSVP',
          message: `${rsvpUser?.fullName} is attending "${event.title}"`,
          link: `/events/${eventId}`,
        },
      });
    }

    return { rsvped: true, rsvpCount: event.rsvpCount + 1 };
  }

  async getUpcomingEvents(limit: number = 5) {
    return prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        isPublic: true,
        startDate: { gte: new Date() },
      },
      include: {
        chapter: {
          select: { id: true, name: true },
        },
      },
      orderBy: { startDate: 'asc' },
      take: limit,
    });
  }

  async getEventAttendees(eventId: string) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        rsvps: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                profilePhotoUrl: true,
                batchYear: true,
                department: true,
                currentDesignation: true,
              },
            },
          },
        },
      },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    return event.rsvps.map(r => ({
      ...r.user,
      rsvpAt: r.rsvpAt,
      attended: r.attended,
    }));
  }
}

export const eventService = new EventService();
