jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn() },
}));

import { eventService, MAX_UPCOMING_LIMIT } from '../../services/eventService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

// createEvent's chapter-admin scoping is covered in chapterScope.test.ts

const notify = notificationService.createNotification as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  title: 'Alumni Meetup',
  description: 'Hello',
  status: 'PUBLISHED',
  isPublic: true,
  createdById: 'owner',
  startDate: inDays(10),
  endDate: null,
  capacity: null,
  rsvpCount: 3,
  rsvps: [
    { id: 'r1', userId: 'u1', rsvpAt: new Date('2026-01-01'), attended: false, user: { id: 'u1', fullName: 'Ann', email: 'ann@x.test' } },
  ],
  ...overrides,
});

beforeEach(() => {
  notify.mockReset().mockResolvedValue(undefined);
});

describe('eventService', () => {
  describe('getEvents', () => {
    beforeEach(() => {
      prismaMock.event.findMany.mockResolvedValue([event()]);
      prismaMock.event.count.mockResolvedValue(13);
    });

    it('shows anonymous visitors only PUBLISHED public events, sorted by start date and paginated', async () => {
      const result = await eventService.getEvents({ page: 2, limit: 12 });
      const args = prismaMock.event.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: 'PUBLISHED', isPublic: true });
      expect(args.orderBy).toEqual({ startDate: 'asc' });
      expect(args.skip).toBe(12);
      expect(args.take).toBe(12);
      expect(prismaMock.event.count).toHaveBeenCalledWith({ where: args.where });
      expect(result.pagination).toMatchObject({ total: 13, page: 2, totalPages: 2 });
    });

    it('includes members-only events for signed-in members (still PUBLISHED only)', async () => {
      await eventService.getEvents({}, { id: 'u1', userRole: 'MEMBER' });
      const { where } = prismaMock.event.findMany.mock.calls[0][0];
      expect(where.status).toBe('PUBLISHED');
      expect(where).not.toHaveProperty('isPublic');
    });

    it('applies type, city, chapter, upcoming and search filters', async () => {
      await eventService.getEvents({ eventType: 'ONLINE', city: 'Pune', chapterId: 'c1', upcoming: true, search: ' gala ' });
      const { where } = prismaMock.event.findMany.mock.calls[0][0];
      expect(where.eventType).toBe('ONLINE');
      expect(where.city).toEqual({ contains: 'Pune', mode: 'insensitive' });
      expect(where.chapterId).toBe('c1');
      expect(where.startDate.gte).toBeInstanceOf(Date);
      expect(where.OR).toEqual([
        { title: { contains: 'gala', mode: 'insensitive' } },
        { description: { contains: 'gala', mode: 'insensitive' } },
        { venue: { contains: 'gala', mode: 'insensitive' } },
        { city: { contains: 'gala', mode: 'insensitive' } },
      ]);
    });

    it('rejects an unknown event type', async () => {
      await expect(eventService.getEvents({ eventType: 'VR' })).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getEvent', () => {
    it('404s for a missing event', async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);
      await expect(eventService.getEvent('nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns a public event to anonymous visitors without the attendee list', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      const result = await eventService.getEvent('e1');
      expect(result.rsvps).toEqual([]);
      expect(result.hasRsvped).toBe(false);
      expect(prismaMock.eventRSVP.findUnique).not.toHaveBeenCalled();
    });

    it('requires sign-in for members-only events', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ isPublic: false }));
      await expect(eventService.getEvent('e1')).rejects.toMatchObject({ statusCode: 401 });
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      await expect(eventService.getEvent('e1', { id: 'u2', userRole: 'MEMBER' })).resolves.toMatchObject({ id: 'e1' });
    });

    it('reports hasRsvped for signed-in users (accepts a bare user id too)', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      prismaMock.eventRSVP.findUnique.mockResolvedValue({ id: 'r1' });
      const result = await eventService.getEvent('e1', 'u1');
      expect(result.hasRsvped).toBe(true);
      expect(result.rsvps).toHaveLength(1);
      expect(prismaMock.eventRSVP.findUnique).toHaveBeenCalledWith({
        where: { eventId_userId: { eventId: 'e1', userId: 'u1' } },
      });
    });

    it('hides DRAFT events from everyone but the creator and admins', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ status: 'DRAFT' }));
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      await expect(eventService.getEvent('e1')).rejects.toMatchObject({ statusCode: 404 });
      await expect(eventService.getEvent('e1', { id: 'u2', userRole: 'MEMBER' })).rejects.toMatchObject({ statusCode: 404 });
      await expect(eventService.getEvent('e1', { id: 'owner', userRole: 'CHAPTER_ADMIN' })).resolves.toBeDefined();
      await expect(eventService.getEvent('e1', { id: 'adm', userRole: 'ADMIN' })).resolves.toBeDefined();
    });

    it('still shows cancelled events (so visitors see the status)', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ status: 'CANCELLED' }));
      await expect(eventService.getEvent('e1')).resolves.toMatchObject({ status: 'CANCELLED' });
    });
  });

  describe('createEvent validation', () => {
    const input = { title: 'Meetup', description: 'd', startDate: inDays(5).toISOString() };

    beforeEach(() => {
      prismaMock.event.create.mockImplementation(async (args: any) => ({ id: 'e9', ...args.data }));
    });

    it('creates a PUBLISHED event with defaults', async () => {
      await eventService.createEvent('adm', input as any, 'ADMIN');
      const { data } = prismaMock.event.create.mock.calls[0][0];
      expect(data).toMatchObject({
        eventType: 'OFFLINE',
        isPublic: true,
        tags: [],
        endDate: null,
        capacity: null,
        status: 'PUBLISHED',
        createdById: 'adm',
      });
      expect(data.startDate).toEqual(new Date(input.startDate));
    });

    it('keeps explicit endDate, capacity and private visibility', async () => {
      const endDate = inDays(6).toISOString();
      await eventService.createEvent('adm', { ...input, endDate, capacity: 50, isPublic: false, eventType: 'HYBRID' } as any, 'ADMIN');
      expect(prismaMock.event.create.mock.calls[0][0].data).toMatchObject({
        endDate: new Date(endDate),
        capacity: 50,
        isPublic: false,
        eventType: 'HYBRID',
      });
    });

    it.each([
      ['a past startDate', { startDate: inDays(-1).toISOString() }],
      ['an invalid startDate', { startDate: 'soon' }],
      ['endDate before startDate', { endDate: inDays(1).toISOString() }],
      ['zero capacity', { capacity: 0 }],
      ['fractional capacity', { capacity: 2.5 }],
      ['unknown type', { eventType: 'VR' }],
    ])('rejects %s with 400', async (_label, extra) => {
      await expect(eventService.createEvent('adm', { ...input, ...extra } as any, 'ADMIN')).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(prismaMock.event.create).not.toHaveBeenCalled();
    });
  });

  describe('updateEvent', () => {
    beforeEach(() => {
      prismaMock.event.update.mockImplementation(async (args: any) => ({ id: 'e1', ...args.data }));
    });

    it('404s for a missing event', async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);
      await expect(eventService.updateEvent('owner', 'nope', { title: 'x' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('403s for non-owners who are not admins', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      await expect(eventService.updateEvent('stranger', 'e1', { title: 'x' })).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.event.update).not.toHaveBeenCalled();
    });

    it('whitelists fields (no rsvpCount / createdById / chapterId / id)', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      await eventService.updateEvent('owner', 'e1', {
        title: 'Renamed',
        rsvpCount: 0,
        createdById: 'hijack',
        chapterId: 'other',
        id: 'x',
      } as any);
      expect(prismaMock.event.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { title: 'Renamed' } });
    });

    it('lets admins edit any event and the owner cancel theirs', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      await eventService.updateEvent('adm', 'e1', { venue: 'Hall B' }, true);
      await eventService.updateEvent('owner', 'e1', { status: 'CANCELLED' });
      expect(prismaMock.event.update.mock.calls[0][0].data).toEqual({ venue: 'Hall B' });
      expect(prismaMock.event.update.mock.calls[1][0].data).toEqual({ status: 'CANCELLED' });
    });

    it('converts and validates dates against stored values', async () => {
      const start = inDays(10);
      prismaMock.event.findUnique.mockResolvedValue(event({ startDate: start, endDate: inDays(11) }));

      // moving the start after the stored end is rejected
      await expect(
        eventService.updateEvent('owner', 'e1', { startDate: inDays(12).toISOString() })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        eventService.updateEvent('owner', 'e1', { startDate: inDays(-2).toISOString() })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        eventService.updateEvent('owner', 'e1', { endDate: inDays(9).toISOString() })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(eventService.updateEvent('owner', 'e1', { startDate: 'garbage' })).rejects.toMatchObject({
        statusCode: 400,
      });

      const newStart = inDays(10.5).toISOString();
      await eventService.updateEvent('owner', 'e1', { startDate: newStart });
      expect(prismaMock.event.update.mock.calls[0][0].data.startDate).toEqual(new Date(newStart));

      await eventService.updateEvent('owner', 'e1', { endDate: null });
      expect(prismaMock.event.update.mock.calls[1][0].data.endDate).toBeNull();
    });

    it('accepts an endDate when no endDate was stored', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      const end = inDays(11).toISOString();
      await eventService.updateEvent('owner', 'e1', { endDate: end });
      expect(prismaMock.event.update.mock.calls[0][0].data.endDate).toEqual(new Date(end));
    });

    it('never lets capacity drop below the current RSVP count', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ rsvpCount: 10 }));
      await expect(eventService.updateEvent('owner', 'e1', { capacity: 5 })).rejects.toMatchObject({ statusCode: 400 });
      await expect(eventService.updateEvent('owner', 'e1', { capacity: -1 })).rejects.toMatchObject({ statusCode: 400 });
      await eventService.updateEvent('owner', 'e1', { capacity: 10 });
      await eventService.updateEvent('owner', 'e1', { capacity: null });
      expect(prismaMock.event.update.mock.calls[0][0].data.capacity).toBe(10);
      expect(prismaMock.event.update.mock.calls[1][0].data.capacity).toBeNull();
    });

    it('rejects bad enums, empty titles, non-boolean isPublic and no-op updates', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      await expect(eventService.updateEvent('owner', 'e1', { status: 'LIVE' } as any)).rejects.toMatchObject({ statusCode: 400 });
      await expect(eventService.updateEvent('owner', 'e1', { eventType: 'VR' } as any)).rejects.toMatchObject({ statusCode: 400 });
      await expect(eventService.updateEvent('owner', 'e1', { title: '' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(eventService.updateEvent('owner', 'e1', { isPublic: 'no' } as any)).rejects.toMatchObject({ statusCode: 400 });
      await expect(eventService.updateEvent('owner', 'e1', { rsvpCount: 1 } as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.event.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteEvent', () => {
    it('404s for a missing event', async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);
      await expect(eventService.deleteEvent('owner', 'nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('403s for non-owners', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      await expect(eventService.deleteEvent('stranger', 'e1')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.event.delete).not.toHaveBeenCalled();
    });

    it('lets the owner or an admin delete', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      await expect(eventService.deleteEvent('owner', 'e1')).resolves.toEqual({ message: 'Event deleted successfully' });
      await eventService.deleteEvent('adm', 'e1', true);
      expect(prismaMock.event.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('rsvpEvent', () => {
    it('404s for a missing event', async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);
      await expect(eventService.rsvpEvent('u1', 'nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    it.each(['CANCELLED', 'DRAFT', 'COMPLETED'])('refuses RSVPs on %s events', async (status) => {
      prismaMock.event.findUnique.mockResolvedValue(event({ status }));
      await expect(eventService.rsvpEvent('u1', 'e1')).rejects.toMatchObject({ statusCode: 400, code: 'EVENT_NOT_AVAILABLE' });
      expect(prismaMock.eventRSVP.create).not.toHaveBeenCalled();
    });

    it('refuses RSVPs once the event has started', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ startDate: inDays(-1) }));
      await expect(eventService.rsvpEvent('u1', 'e1')).rejects.toMatchObject({ statusCode: 400, code: 'EVENT_PAST' });
      expect(prismaMock.eventRSVP.findUnique).not.toHaveBeenCalled();
    });

    it('creates an RSVP, increments the count and notifies the creator', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue({ fullName: 'Ann' });
      // Atomic, capacity-guarded increment returns the new count
      prismaMock.$queryRaw.mockResolvedValue([{ rsvpCount: 4 }]);

      const result = await eventService.rsvpEvent('u1', 'e1');

      expect(result).toEqual({ rsvped: true, rsvpCount: 4 });
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      expect(prismaMock.eventRSVP.create).toHaveBeenCalledWith({ data: { eventId: 'e1', userId: 'u1' } });
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner', type: 'EVENT_RSVP', message: 'Ann is attending "Alumni Meetup"' })
      );
    });

    it("doesn't notify creators about their own RSVP", async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      prismaMock.$queryRaw.mockResolvedValue([{ rsvpCount: 4 }]);
      await eventService.rsvpEvent('owner', 'e1');
      expect(notify).not.toHaveBeenCalled();
    });

    it('keeps the RSVP when the notification fails', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.$queryRaw.mockResolvedValue([{ rsvpCount: 4 }]);
      notify.mockRejectedValue(new Error('down'));
      await expect(eventService.rsvpEvent('u1', 'e1')).resolves.toEqual({ rsvped: true, rsvpCount: 4 });
    });

    it('toggles an existing RSVP off with a guarded decrement', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      prismaMock.eventRSVP.findUnique.mockResolvedValue({ id: 'r1' });

      const result = await eventService.rsvpEvent('u1', 'e1');

      expect(result).toEqual({ rsvped: false, rsvpCount: 2 });
      expect(prismaMock.eventRSVP.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(prismaMock.event.updateMany).toHaveBeenCalledWith({
        where: { id: 'e1', rsvpCount: { gt: 0 } },
        data: { rsvpCount: { decrement: 1 } },
      });
      expect(prismaMock.eventRSVP.create).not.toHaveBeenCalled();
    });

    it('never reports a negative rsvpCount', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ rsvpCount: 0 }));
      prismaMock.eventRSVP.findUnique.mockResolvedValue({ id: 'r1' });
      await expect(eventService.rsvpEvent('u1', 'e1')).resolves.toEqual({ rsvped: false, rsvpCount: 0 });
    });

    it('returns 409 when the event is full', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ capacity: 3, rsvpCount: 3 }));
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      // The capacity-guarded UPDATE matches no row when the event is full
      prismaMock.$queryRaw.mockResolvedValue([]);
      await expect(eventService.rsvpEvent('u1', 'e1')).rejects.toMatchObject({ statusCode: 409, code: 'EVENT_FULL' });
      expect(prismaMock.eventRSVP.create).not.toHaveBeenCalled();
    });

    it('still lets an attendee withdraw from a full event', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ capacity: 3, rsvpCount: 3 }));
      prismaMock.eventRSVP.findUnique.mockResolvedValue({ id: 'r1' });
      await expect(eventService.rsvpEvent('u1', 'e1')).resolves.toEqual({ rsvped: false, rsvpCount: 2 });
    });

    it('accepts the last seat', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ capacity: 4, rsvpCount: 3 }));
      prismaMock.eventRSVP.findUnique.mockResolvedValue(null);
      // The guarded UPDATE takes the last seat and returns the new count
      prismaMock.$queryRaw.mockResolvedValue([{ rsvpCount: 4 }]);
      await expect(eventService.rsvpEvent('u1', 'e1')).resolves.toEqual({ rsvped: true, rsvpCount: 4 });
    });
  });

  describe('getUpcomingEvents', () => {
    it('returns future public published events sorted ascending, limited', async () => {
      prismaMock.event.findMany.mockResolvedValue([]);
      await eventService.getUpcomingEvents(3);
      const args = prismaMock.event.findMany.mock.calls[0][0];
      expect(args.where.status).toBe('PUBLISHED');
      expect(args.where.isPublic).toBe(true);
      expect(args.where.startDate.gte).toBeInstanceOf(Date);
      expect(args.orderBy).toEqual({ startDate: 'asc' });
      expect(args.take).toBe(3);
    });

    it('clamps the limit', async () => {
      prismaMock.event.findMany.mockResolvedValue([]);
      await eventService.getUpcomingEvents(10_000);
      await eventService.getUpcomingEvents(0);
      await eventService.getUpcomingEvents(NaN);
      await eventService.getUpcomingEvents();
      const takes = prismaMock.event.findMany.mock.calls.map((c: any[]) => c[0].take);
      expect(takes).toEqual([MAX_UPCOMING_LIMIT, 1, 5, 5]);
    });
  });

  describe('getEventAttendees', () => {
    it('404s for a missing event', async () => {
      prismaMock.event.findUnique.mockResolvedValue(null);
      await expect(eventService.getEventAttendees('nope')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('returns attendees without emails to regular members', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      const result = await eventService.getEventAttendees('e1', { id: 'u2', userRole: 'MEMBER' });
      expect(result).toEqual([
        { id: 'u1', userId: 'u1', fullName: 'Ann', rsvpAt: new Date('2026-01-01'), attended: false },
      ]);
    });

    it('includes emails for the creator and admins', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event());
      const asOwner = await eventService.getEventAttendees('e1', { id: 'owner', userRole: 'CHAPTER_ADMIN' });
      const asAdmin = await eventService.getEventAttendees('e1', { id: 'adm', userRole: 'ADMIN' });
      expect(asOwner[0].email).toBe('ann@x.test');
      expect(asAdmin[0].email).toBe('ann@x.test');
    });

    it('hides attendees of DRAFT events from non-owners', async () => {
      prismaMock.event.findUnique.mockResolvedValue(event({ status: 'DRAFT' }));
      await expect(eventService.getEventAttendees('e1', { id: 'u2', userRole: 'MEMBER' })).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(eventService.getEventAttendees('e1', { id: 'owner' })).resolves.toHaveLength(1);
    });
  });
});
