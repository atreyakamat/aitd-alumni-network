jest.mock('../../services/mentorshipService', () => ({
  mentorshipService: {
    getMentors: jest.fn(),
    getMentorProfile: jest.fn(),
    createMentorProfile: jest.fn(),
    updateMentorProfile: jest.fn(),
    deleteMentorProfile: jest.fn(),
    requestMentorship: jest.fn(),
    respondToRequest: jest.fn(),
    getMyMentorshipRequests: jest.fn(),
    scheduleSession: jest.fn(),
    completeSession: jest.fn(),
    getMentorshipSessions: jest.fn(),
    endMentorship: jest.fn(),
  },
}));

import { mentorshipController } from '../../controllers/mentorshipController';
import { mentorshipService } from '../../services/mentorshipService';
import { mockReqRes } from '../../../tests/helpers';

const svc = mentorshipService as unknown as Record<string, jest.Mock>;
const user = { id: 'u1', userRole: 'MEMBER' };
const boom = new Error('boom');

beforeEach(() => Object.values(svc).forEach((fn) => fn.mockReset().mockResolvedValue({ ok: true })));

const run = async (method: string, reqInit: Record<string, unknown>) => {
  const ctx = mockReqRes({ user, ...reqInit });
  await (mentorshipController as any)[method](ctx.req, ctx.res, ctx.next);
  return ctx;
};

describe('mentorshipController', () => {
  it('getMentors parses paging and filters', async () => {
    const { res } = await run('getMentors', { query: { page: '2', limit: '5', focusArea: 'AI', search: 'ann', available: 'true' } });
    expect(svc.getMentors).toHaveBeenCalledWith(2, 5, { focusArea: 'AI', search: 'ann', available: true });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { ok: true } });

    await run('getMentors', { query: {} });
    expect(svc.getMentors).toHaveBeenLastCalledWith(1, 20, { focusArea: undefined, search: undefined, available: false });
  });

  it('getMentorProfile looks up by route param; getMyMentorProfile by caller', async () => {
    await run('getMentorProfile', { params: { userId: 'm1' } });
    expect(svc.getMentorProfile).toHaveBeenLastCalledWith('m1');
    await run('getMyMentorProfile', {});
    expect(svc.getMentorProfile).toHaveBeenLastCalledWith('u1');
  });

  it('profile create (201) / update / delete act on the caller', async () => {
    const created = await run('createMentorProfile', { body: { focusAreas: ['A'] } });
    expect(svc.createMentorProfile).toHaveBeenCalledWith('u1', { focusAreas: ['A'] });
    expect(created.res.status).toHaveBeenCalledWith(201);

    await run('updateMentorProfile', { body: { bio: 'b' } });
    expect(svc.updateMentorProfile).toHaveBeenCalledWith('u1', { bio: 'b' });

    await run('deleteMentorProfile', {});
    expect(svc.deleteMentorProfile).toHaveBeenCalledWith('u1');
  });

  it('requestMentorship uses the caller as mentee and returns 201', async () => {
    const { res } = await run('requestMentorship', { params: { mentorId: 'm1' }, body: { message: 'hi' } });
    expect(svc.requestMentorship).toHaveBeenCalledWith('u1', 'm1', { message: 'hi' });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('respondToRequest passes the accept flag through untouched', async () => {
    await run('respondToRequest', { params: { requestId: 'r1' }, body: { accept: false } });
    expect(svc.respondToRequest).toHaveBeenCalledWith('u1', 'r1', false);
  });

  it('request listings pick the right side', async () => {
    await run('getMyMentorRequests', { query: { status: 'PENDING' } });
    expect(svc.getMyMentorshipRequests).toHaveBeenLastCalledWith('u1', 'mentor', 'PENDING');
    await run('getMyMenteeRequests', { query: {} });
    expect(svc.getMyMentorshipRequests).toHaveBeenLastCalledWith('u1', 'mentee', undefined);
  });

  it('session handlers pass caller, ids and body', async () => {
    const scheduled = await run('scheduleSession', { params: { requestId: 'r1' }, body: { scheduledAt: 'x' } });
    expect(svc.scheduleSession).toHaveBeenCalledWith('u1', 'r1', { scheduledAt: 'x' });
    expect(scheduled.res.status).toHaveBeenCalledWith(201);

    await run('completeSession', { params: { sessionId: 's1' }, body: { outcomes: 'good' } });
    expect(svc.completeSession).toHaveBeenCalledWith('u1', 's1', 'good');

    await run('getSessions', { params: { requestId: 'r1' } });
    expect(svc.getMentorshipSessions).toHaveBeenCalledWith('r1', 'u1');

    await run('endMentorship', { params: { requestId: 'r1' } });
    expect(svc.endMentorship).toHaveBeenCalledWith('u1', 'r1');
  });

  it.each([
    ['getMentors', 'getMentors'],
    ['getMentorProfile', 'getMentorProfile'],
    ['getMyMentorProfile', 'getMentorProfile'],
    ['createMentorProfile', 'createMentorProfile'],
    ['updateMentorProfile', 'updateMentorProfile'],
    ['deleteMentorProfile', 'deleteMentorProfile'],
    ['requestMentorship', 'requestMentorship'],
    ['respondToRequest', 'respondToRequest'],
    ['getMyMentorRequests', 'getMyMentorshipRequests'],
    ['getMyMenteeRequests', 'getMyMentorshipRequests'],
    ['scheduleSession', 'scheduleSession'],
    ['completeSession', 'completeSession'],
    ['getSessions', 'getMentorshipSessions'],
    ['endMentorship', 'endMentorship'],
  ])('%s forwards service errors to next()', async (handler, serviceMethod) => {
    svc[serviceMethod].mockRejectedValue(boom);
    const { res, next } = await run(handler, { params: {}, body: {}, query: {} });
    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});
