import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse, ilike } from '../utils/helpers';
import { EventType, EventStatus, Prisma, UserRole } from '@prisma/client';
import { isAdminRole, isOwnerOrAdmin, Actor } from '../config/permissions';
import { notificationService } from './notificationService';
import { clientLinks } from '../utils/clientLinks';

export interface CreateEventInput {
  title: string;
  description: string;
  bannerUrl?: string;
  eventType?: EventType;
  venue?: string;
  address?: string;
  city?: string;
  joinLink?: string;
  startDate: Date | string;
  endDate?: Date | string | null;
  capacity?: number | null;
  tags?: string[];
  isPublic?: boolean;
  chapterId?: string;
}

export interface UpdateEventInput extends Partial<CreateEventInput> {
  status?: EventStatus;
}

export interface EventFilters {
  eventType?: EventType | string;
  city?: string;
  chapterId?: string;
  upcoming?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

const EVENT_TYPES = Object.values(EventType) as string[];
const EVENT_STATUSES = Object.values(EventStatus) as string[];
export const MAX_UPCOMING_LIMIT = 20;

/** Fields an event owner (or admin) may edit. rsvpCount/createdById/id are never mass-assigned. */
const EDITABLE_FIELDS = [
  'title',
  'description',
  'bannerUrl',
  'eventType',
  'venue',
  'address',
  'city',
  'joinLink',
  'startDate',
  'endDate',
  'capacity',
  'tags',
  'isPublic',
  'status',
] as const;

const badRequest = (message: string) => new AppError(message, 400, 'VALIDATION_ERROR');

const parseDate = (value: unknown, field: string): Date => {
  const date = value instanceof Date ? value : new Date(value as string);
  if (value === null || value === undefined || value === '' || Number.isNaN(date.getTime())) {
    throw badRequest(`${field} must be a valid date`);
  }
  return date;
};

const parseCapacity = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw badRequest('capacity must be a positive integer');
  }
  return value;
};

const assertEnum = (value: unknown, allowed: string[], field: string) => {
  if (value !== undefined && !allowed.includes(value as string)) {
    throw badRequest(`Invalid ${field}`);
  }
};

const hasStarted = (event: { startDate: Date | string }) => new Date(event.startDate).getTime() <= Date.now();

export class EventService {
  /**
   * Published events only. Anonymous visitors see public events; signed-in
   * members additionally see members-only (isPublic=false) events.
   */
  async getEvents(filters: EventFilters, viewer?: Actor | null) {
    const { skip, take, page, limit } = paginationHelper(filters.page, filters.limit);

    assertEnum(filters.eventType, EVENT_TYPES, 'event type');

    const where: Prisma.EventWhereInput = { status: 'PUBLISHED' };

    if (!viewer) {
      where.isPublic = true;
    }

    if (filters.eventType) where.eventType = filters.eventType as EventType;
    if (filters.city) where.city = ilike(filters.city);
    if (filters.chapterId) where.chapterId = filters.chapterId;
    if (filters.upcoming) where.startDate = { gte: new Date() };

    const search = filters.search?.trim();
    if (search) {
      where.OR = [
        { title: ilike(search) },
        { description: ilike(search) },
        { venue: ilike(search) },
        { city: ilike(search) },
      ];
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

  /**
   * Event detail. Unpublished (DRAFT) events are only visible to their creator
   * and admins. Members-only events require sign-in. Anonymous visitors don't
   * receive the attendee list.
   */
  async getEvent(id: string, viewer?: Actor | string | null) {
    const actor: Actor | null = typeof viewer === 'string' ? { id: viewer } : viewer ?? null;

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

    if (event.status === 'DRAFT' && !isOwnerOrAdmin(actor, event.createdById)) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (!event.isPublic && !actor) {
      throw new AppError('Sign in to view this members-only event', 401, 'AUTH_REQUIRED');
    }

    if (!actor) {
      return { ...event, rsvps: [], hasRsvped: false };
    }

    const rsvp = await prisma.eventRSVP.findUnique({
      where: { eventId_userId: { eventId: id, userId: actor.id } },
    });

    return { ...event, hasRsvped: !!rsvp };
  }

  async createEvent(userId: string, data: CreateEventInput, actorRole: UserRole) {
    if (!isAdminRole(actorRole)) {
      // Chapter admins may only create events for the chapter they run
      if (!data.chapterId) {
        throw new AppError('Chapter admins must create events for their chapter', 403, 'FORBIDDEN');
      }
      const chapter = await prisma.chapter.findUnique({ where: { id: data.chapterId } });
      if (!chapter || chapter.adminUserId !== userId) {
        throw new AppError('You can only create events for the chapter you administer', 403, 'FORBIDDEN');
      }
    }

    const startDate = parseDate(data.startDate, 'startDate');
    if (startDate.getTime() <= Date.now()) {
      throw badRequest('startDate must be in the future');
    }
    const endDate = data.endDate ? parseDate(data.endDate, 'endDate') : null;
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw badRequest('endDate cannot be before startDate');
    }
    const capacity = parseCapacity(data.capacity);
    assertEnum(data.eventType, EVENT_TYPES, 'event type');

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
        startDate,
        endDate,
        capacity,
        tags: data.tags || [],
        isPublic: data.isPublic ?? true,
        chapterId: data.chapterId,
        createdById: userId,
        status: 'PUBLISHED',
      },
    });

    return event;
  }

  /** Owner or admin; whitelisted fields only. */
  async updateEvent(userId: string, eventId: string, data: UpdateEventInput, isAdmin: boolean = false) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    if (event.createdById !== userId && !isAdmin) {
      throw new AppError('Not authorized to update this event', 403, 'FORBIDDEN');
    }

    const input = (data || {}) as Record<string, unknown>;
    const update: Prisma.EventUpdateInput = {};
    for (const field of EDITABLE_FIELDS) {
      if (input[field] !== undefined) {
        (update as Record<string, unknown>)[field] = input[field];
      }
    }

    if (Object.keys(update).length === 0) {
      throw badRequest('No valid fields to update');
    }

    assertEnum(update.eventType, EVENT_TYPES, 'event type');
    assertEnum(update.status, EVENT_STATUSES, 'status');

    for (const field of ['title', 'description'] as const) {
      if (field in update && (typeof update[field] !== 'string' || !(update[field] as string).trim())) {
        throw badRequest(`${field} cannot be empty`);
      }
    }

    if ('isPublic' in update && typeof update.isPublic !== 'boolean') {
      throw badRequest('isPublic must be a boolean');
    }

    const startDate = 'startDate' in update ? parseDate(input.startDate, 'startDate') : new Date(event.startDate);
    const endDate =
      'endDate' in update
        ? input.endDate === null || input.endDate === ''
          ? null
          : parseDate(input.endDate, 'endDate')
        : event.endDate
          ? new Date(event.endDate)
          : null;

    if ('startDate' in update) {
      if (startDate.getTime() <= Date.now()) throw badRequest('startDate must be in the future');
      update.startDate = startDate;
    }
    if ('endDate' in update) update.endDate = endDate;
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw badRequest('endDate cannot be before startDate');
    }

    if ('capacity' in update) {
      const capacity = parseCapacity(input.capacity);
      if (capacity !== null && capacity < event.rsvpCount) {
        throw badRequest(`capacity cannot be below the current RSVP count (${event.rsvpCount})`);
      }
      update.capacity = capacity;
    }

    return prisma.event.update({
      where: { id: eventId },
      data: update,
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

  /**
   * Toggle the caller's RSVP. Only PUBLISHED events that haven't started
   * accept RSVP changes; a full event returns 409. rsvpCount never goes negative.
   */
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

    if (hasStarted(event)) {
      throw new AppError('This event has already started', 400, 'EVENT_PAST');
    }

    // The whole toggle runs in one transaction. The capacity guard in particular must be
    // inside it: with a pre-check outside the write, two members grabbing the last seat would
    // both read rsvpCount < capacity and both commit, overbooking the event past capacity.
    const toggle = await prisma.$transaction(async (tx) => {
      const existingRsvp = await tx.eventRSVP.findUnique({
        where: { eventId_userId: { eventId, userId } },
      });

      if (existingRsvp) {
        // Cancel RSVP; the guarded decrement keeps rsvpCount >= 0
        await tx.eventRSVP.delete({ where: { id: existingRsvp.id } });
        await tx.event.updateMany({
          where: { id: eventId, rsvpCount: { gt: 0 } },
          data: { rsvpCount: { decrement: 1 } },
        });
        return { rsvped: false, rsvpCount: Math.max(0, event.rsvpCount - 1) };
      }

      // Atomic, capacity-guarded increment that also returns the new count. The UPDATE locks
      // the event row, so a concurrent RSVP re-evaluates rsvpCount < capacity against the
      // committed value and cannot overbook. (A column-vs-column comparison isn't expressible
      // in Prisma's typed `where`, hence raw SQL; 0 rows back means the event is full.)
      const rows = (await tx.$queryRaw<Array<{ rsvpCount: number | bigint }>>`
        UPDATE "Event"
        SET "rsvpCount" = "rsvpCount" + 1, "updatedAt" = NOW()
        WHERE "id" = ${eventId} AND ("capacity" IS NULL OR "rsvpCount" < "capacity")
        RETURNING "rsvpCount"
      `) ?? [];
      if (rows.length === 0) {
        throw new AppError('Event is at full capacity', 409, 'EVENT_FULL');
      }
      await tx.eventRSVP.create({ data: { eventId, userId } });
      return { rsvped: true, rsvpCount: Number(rows[0].rsvpCount) };
    });

    if (!toggle.rsvped) {
      return toggle;
    }

    if (event.createdById !== userId) {
      try {
        const rsvpUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { fullName: true },
        });

        await notificationService.createNotification({
          userId: event.createdById,
          type: 'EVENT_RSVP',
          title: 'New RSVP',
          message: `${rsvpUser?.fullName ?? 'Someone'} is attending "${event.title}"`,
          link: clientLinks.event(eventId),
          metadata: { eventId, rsvpUserId: userId },
        });
      } catch (err) {
        // The RSVP is committed; a notification failure must not undo it
        console.error('RSVP notification failed:', err);
      }
    }

    return toggle;
  }

  async getUpcomingEvents(limit: number = 5) {
    const take = Number.isFinite(limit) ? Math.min(MAX_UPCOMING_LIMIT, Math.max(1, Math.floor(limit))) : 5;
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
      take,
    });
  }

  /**
   * Attendee list. Emails are only included for the event creator and admins;
   * unpublished events are hidden from everyone else.
   */
  async getEventAttendees(eventId: string, viewer?: Actor | null) {
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
          orderBy: { rsvpAt: 'asc' },
        },
      },
    });

    if (!event) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    const privileged = isOwnerOrAdmin(viewer, event.createdById);
    if (event.status === 'DRAFT' && !privileged) {
      throw new AppError('Event not found', 404, 'NOT_FOUND');
    }

    return event.rsvps.map(r => {
      const { email, ...publicUser } = r.user;
      return {
        ...publicUser,
        ...(privileged ? { email } : {}),
        userId: r.user.id,
        rsvpAt: r.rsvpAt,
        attended: r.attended,
      };
    });
  }
}

export const eventService = new EventService();
