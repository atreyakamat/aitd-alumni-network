jest.mock('../../services/eventService', () => ({
  eventService: {
    getEvents: jest.fn(),
    getEvent: jest.fn(),
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    deleteEvent: jest.fn(),
    rsvpEvent: jest.fn(),
    getUpcomingEvents: jest.fn(),
    getEventAttendees: jest.fn(),
  },
}));

import { eventController, parseEventFilters } from '../../controllers/eventController';
import { eventService } from '../../services/eventService';
import { mockReqRes } from '../../../tests/helpers';

const svc = eventService as unknown as Record<string, jest.Mock>;
const member = { id: 'u1', userRole: 'MEMBER' };
const boom = new Error('boom');

beforeEach(() => Object.values(svc).forEach((fn) => fn.mockReset()));

describe('parseEventFilters', () => {
  it("maps the client's type alias, parses upcoming as a boolean and whitelists params", () => {
    expect(
      parseEventFilters({ type: 'ONLINE', upcoming: 'false', search: ' gala ', page: '2', isPublic: 'false' } as any)
    ).toEqual({
      eventType: 'ONLINE',
      city: undefined,
      chapterId: undefined,
      upcoming: false,
      search: 'gala',
      page: 2,
      limit: 12,
    });
    expect(parseEventFilters({ upcoming: 'true', eventType: 'HYBRID', city: 'Goa', chapterId: 'c1', q: 'x', limit: '3' } as any)).toMatchObject({
      upcoming: true,
      eventType: 'HYBRID',
      city: 'Goa',
      chapterId: 'c1',
      search: 'x',
      limit: 3,
    });
    expect(parseEventFilters({ upcoming: '1', page: 'zz' } as any)).toMatchObject({ upcoming: true, page: 1 });
  });
});

describe('eventController', () => {
  it('getEvents passes filters and the viewer', async () => {
    svc.getEvents.mockResolvedValue({ data: [], pagination: { total: 0 } });
    const anon = mockReqRes({ query: {} });
    await eventController.getEvents(anon.req, anon.res, anon.next);
    expect(svc.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, upcoming: false }), null);
    expect(anon.res.json).toHaveBeenCalledWith({ success: true, data: [], pagination: { total: 0 } });

    const signedIn = mockReqRes({ query: {}, user: member });
    await eventController.getEvents(signedIn.req, signedIn.res, signedIn.next);
    expect(svc.getEvents).toHaveBeenLastCalledWith(expect.any(Object), member);
  });

  it('getEvent passes the viewer', async () => {
    svc.getEvent.mockResolvedValue({ id: 'e1' });
    const { req, res, next } = mockReqRes({ params: { id: 'e1' }, user: member });
    await eventController.getEvent(req, res, next);
    expect(svc.getEvent).toHaveBeenCalledWith('e1', member);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'e1' } });
  });

  it('createEvent passes the actor role and returns 201', async () => {
    svc.createEvent.mockResolvedValue({ id: 'e1' });
    const { req, res, next } = mockReqRes({ body: { title: 't' }, user: { id: 'ca', userRole: 'CHAPTER_ADMIN' } });
    await eventController.createEvent(req, res, next);
    expect(svc.createEvent).toHaveBeenCalledWith('ca', { title: 't' }, 'CHAPTER_ADMIN');
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('updateEvent / deleteEvent pass the admin flag', async () => {
    svc.updateEvent.mockResolvedValue({ id: 'e1' });
    svc.deleteEvent.mockResolvedValue({ message: 'ok' });
    const u = mockReqRes({ params: { id: 'e1' }, body: { title: 'x' }, user: { id: 'adm', userRole: 'ADMIN' } });
    await eventController.updateEvent(u.req, u.res, u.next);
    expect(svc.updateEvent).toHaveBeenCalledWith('adm', 'e1', { title: 'x' }, true);
    const d = mockReqRes({ params: { id: 'e1' }, user: member });
    await eventController.deleteEvent(d.req, d.res, d.next);
    expect(svc.deleteEvent).toHaveBeenCalledWith('u1', 'e1', false);
  });

  it('rsvpEvent toggles for the caller', async () => {
    svc.rsvpEvent.mockResolvedValue({ rsvped: true, rsvpCount: 1 });
    const { req, res, next } = mockReqRes({ params: { id: 'e1' }, user: member });
    await eventController.rsvpEvent(req, res, next);
    expect(svc.rsvpEvent).toHaveBeenCalledWith('u1', 'e1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { rsvped: true, rsvpCount: 1 } });
  });

  it('getUpcomingEvents parses the limit with a default', async () => {
    svc.getUpcomingEvents.mockResolvedValue([]);
    const a = mockReqRes({ query: { limit: '3' } });
    await eventController.getUpcomingEvents(a.req, a.res, a.next);
    expect(svc.getUpcomingEvents).toHaveBeenLastCalledWith(3);
    const b = mockReqRes({ query: { limit: 'lots' } });
    await eventController.getUpcomingEvents(b.req, b.res, b.next);
    expect(svc.getUpcomingEvents).toHaveBeenLastCalledWith(5);
  });

  it('getEventAttendees passes the viewer', async () => {
    svc.getEventAttendees.mockResolvedValue([]);
    const { req, res, next } = mockReqRes({ params: { id: 'e1' }, user: member });
    await eventController.getEventAttendees(req, res, next);
    expect(svc.getEventAttendees).toHaveBeenCalledWith('e1', member);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it.each([
    ['getEvents', {}],
    ['getEvent', { params: { id: 'e1' } }],
    ['createEvent', { user: member }],
    ['updateEvent', { params: { id: 'e1' }, user: member }],
    ['deleteEvent', { params: { id: 'e1' }, user: member }],
    ['rsvpEvent', { params: { id: 'e1' }, user: member }],
    ['getUpcomingEvents', {}],
    ['getEventAttendees', { params: { id: 'e1' }, user: member }],
  ])('%s forwards service errors to next()', async (method, reqInit) => {
    svc[method].mockRejectedValue(boom);
    const { req, res, next } = mockReqRes(reqInit as any);
    await (eventController as any)[method](req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});
