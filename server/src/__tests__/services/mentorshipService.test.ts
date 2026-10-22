jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn() },
}));

import { mentorshipService, MAX_MENTEES, MAX_FOCUS_AREAS } from '../../services/mentorshipService';
import { notificationService } from '../../services/notificationService';
import { prismaMock } from '../../../tests/helpers';

const notify = notificationService.createNotification as jest.Mock;

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY);

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: 'p1',
  userId: 'mentor',
  focusAreas: ['Backend', 'Career Growth'],
  bio: 'Distributed systems nerd',
  maxMentees: 3,
  currentMentees: 1,
  isActive: true,
  user: { id: 'mentor', fullName: 'Maya Mentor', isActive: true },
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  menteeId: 'mentee',
  mentorId: 'mentor',
  profileId: 'p1',
  status: 'PENDING',
  mentee: { id: 'mentee', fullName: 'Manu Mentee' },
  mentor: { id: 'mentor', fullName: 'Maya Mentor' },
  profile: profile(),
  ...overrides,
});

beforeEach(() => {
  notify.mockReset().mockResolvedValue(undefined);
});

describe('mentorshipService', () => {
  describe('getMentors', () => {
    const mentors = [
      profile({ id: 'p1', focusAreas: ['Backend'], user: { fullName: 'Asha' }, bio: null }),
      profile({ id: 'p2', focusAreas: ['Design'], user: { fullName: 'Bala' }, currentMentees: 3, maxMentees: 3 }),
      profile({ id: 'p3', focusAreas: ['Product', 'backend APIs'], user: { fullName: 'Chitra' }, bio: 'Loves fintech' }),
      profile({ id: 'p4', focusAreas: 'not-an-array', user: { fullName: 'Dev' }, bio: null }),
    ];

    it('paginates in the database when no in-memory filters are used', async () => {
      prismaMock.mentorProfile.findMany.mockResolvedValue(mentors.slice(0, 2));
      prismaMock.mentorProfile.count.mockResolvedValue(42);

      const result = await mentorshipService.getMentors(2, 20);

      const args = prismaMock.mentorProfile.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true, user: { isActive: true } });
      expect(args.skip).toBe(20);
      expect(args.take).toBe(20);
      expect(result.pagination).toMatchObject({ total: 42, page: 2, totalPages: 3 });
    });

    it('filters by focus area (case-insensitive) with a correct total', async () => {
      prismaMock.mentorProfile.findMany.mockResolvedValue(mentors);
      const result = await mentorshipService.getMentors(1, 20, { focusArea: 'BACKEND' });
      expect(result.data.map((m: any) => m.id)).toEqual(['p1', 'p3']);
      expect(result.pagination.total).toBe(2);
      expect(prismaMock.mentorProfile.findMany.mock.calls[0][0].skip).toBeUndefined();
      expect(prismaMock.mentorProfile.count).not.toHaveBeenCalled();
    });

    it('filters by availability', async () => {
      prismaMock.mentorProfile.findMany.mockResolvedValue(mentors);
      const result = await mentorshipService.getMentors(1, 20, { available: true });
      expect(result.data.map((m: any) => m.id)).toEqual(['p1', 'p3', 'p4']);
    });

    it('searches name, bio and focus areas', async () => {
      prismaMock.mentorProfile.findMany.mockResolvedValue(mentors);
      const byName = await mentorshipService.getMentors(1, 20, { search: 'bala' });
      const byBio = await mentorshipService.getMentors(1, 20, { search: 'FINTECH' });
      const byArea = await mentorshipService.getMentors(1, 20, { search: 'design' });
      expect(byName.data.map((m: any) => m.id)).toEqual(['p2']);
      expect(byBio.data.map((m: any) => m.id)).toEqual(['p3']);
      expect(byArea.data.map((m: any) => m.id)).toEqual(['p2']);
    });

    it('paginates filtered results in memory', async () => {
      prismaMock.mentorProfile.findMany.mockResolvedValue(mentors);
      const result = await mentorshipService.getMentors(2, 2, { available: true });
      expect(result.data.map((m: any) => m.id)).toEqual(['p4']);
      expect(result.pagination).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
    });
  });

  describe('getMentorProfile', () => {
    it('returns the profile', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile());
      await expect(mentorshipService.getMentorProfile('mentor')).resolves.toMatchObject({ id: 'p1' });
      expect(prismaMock.mentorProfile.findUnique.mock.calls[0][0].where).toEqual({ userId: 'mentor' });
    });

    it('404s when missing', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.getMentorProfile('x')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('createMentorProfile', () => {
    beforeEach(() => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(null);
      prismaMock.mentorProfile.create.mockImplementation(async (args: any) => ({ id: 'p9', ...args.data }));
    });

    it('creates a profile with trimmed, de-duplicated focus areas and default capacity', async () => {
      await mentorshipService.createMentorProfile('u1', {
        focusAreas: [' Backend ', 'backend', 'Careers', ''],
        bio: 'Hi',
        availability: 'Weekends',
      });
      expect(prismaMock.mentorProfile.create.mock.calls[0][0].data).toEqual({
        userId: 'u1',
        focusAreas: ['Backend', 'Careers'],
        availability: 'Weekends',
        bio: 'Hi',
        maxMentees: 5,
      });
    });

    it('accepts maxMentees within bounds', async () => {
      await mentorshipService.createMentorProfile('u1', { focusAreas: ['A'], maxMentees: MAX_MENTEES });
      expect(prismaMock.mentorProfile.create.mock.calls[0][0].data.maxMentees).toBe(MAX_MENTEES);
    });

    it.each([
      ['missing focusAreas', {}],
      ['non-array focusAreas', { focusAreas: 'Backend' }],
      ['non-string focus area', { focusAreas: ['ok', 3] }],
      ['empty focusAreas', { focusAreas: ['  '] }],
      ['too many focusAreas', { focusAreas: Array.from({ length: MAX_FOCUS_AREAS + 1 }, (_, i) => `a${i}`) }],
      ['maxMentees 0', { focusAreas: ['A'], maxMentees: 0 }],
      ['maxMentees above the cap', { focusAreas: ['A'], maxMentees: MAX_MENTEES + 1 }],
      ['fractional maxMentees', { focusAreas: ['A'], maxMentees: 2.5 }],
      ['non-string bio', { focusAreas: ['A'], bio: 42 }],
    ])('rejects %s with 400', async (_label, data) => {
      await expect(mentorshipService.createMentorProfile('u1', data as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.mentorProfile.create).not.toHaveBeenCalled();
    });

    it('409s when the user already has a profile', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile());
      await expect(mentorshipService.createMentorProfile('mentor', { focusAreas: ['A'] })).rejects.toMatchObject({
        statusCode: 409,
      });
    });
  });

  describe('updateMentorProfile', () => {
    beforeEach(() => {
      prismaMock.mentorProfile.update.mockImplementation(async (args: any) => ({ id: 'p1', ...args.data }));
    });

    it('updates only provided, validated fields', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile());
      await mentorshipService.updateMentorProfile('mentor', {
        focusAreas: ['Cloud'],
        maxMentees: 4,
        isActive: false,
        bio: '',
        currentMentees: 0,
      } as any);
      expect(prismaMock.mentorProfile.update).toHaveBeenCalledWith({
        where: { userId: 'mentor' },
        data: { focusAreas: ['Cloud'], maxMentees: 4, isActive: false, bio: '' },
      });
    });

    it('clears availability with null', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile());
      await mentorshipService.updateMentorProfile('mentor', { availability: null } as any);
      expect(prismaMock.mentorProfile.update.mock.calls[0][0].data).toEqual({ availability: null });
    });

    it('404s without a profile', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.updateMentorProfile('x', { bio: 'b' })).rejects.toMatchObject({ statusCode: 404 });
    });

    it.each([
      ['empty focusAreas', { focusAreas: [] }],
      ['maxMentees out of bounds', { maxMentees: 99 }],
      ['non-boolean isActive', { isActive: 'yes' }],
    ])('rejects %s', async (_label, data) => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile());
      await expect(mentorshipService.updateMentorProfile('mentor', data as any)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects a no-op update', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile());
      await expect(mentorshipService.updateMentorProfile('mentor', {})).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.mentorProfile.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteMentorProfile', () => {
    it('deletes a profile with no active mentees', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile({ currentMentees: 0 }));
      await expect(mentorshipService.deleteMentorProfile('mentor')).resolves.toEqual({
        message: 'Mentor profile deleted successfully',
      });
      expect(prismaMock.mentorProfile.delete).toHaveBeenCalledWith({ where: { userId: 'mentor' } });
    });

    it('refuses while mentorships are active', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile({ currentMentees: 2 }));
      await expect(mentorshipService.deleteMentorProfile('mentor')).rejects.toMatchObject({ statusCode: 409 });
      expect(prismaMock.mentorProfile.delete).not.toHaveBeenCalled();
    });

    it('404s without a profile', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.deleteMentorProfile('x')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('requestMentorship', () => {
    beforeEach(() => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile());
      prismaMock.mentorshipRequest.findFirst.mockResolvedValue(null);
      prismaMock.mentorshipRequest.create.mockImplementation(async (args: any) => ({
        id: 'r9',
        ...args.data,
        mentee: { id: 'mentee', fullName: 'Manu Mentee' },
      }));
    });

    it('creates a request and notifies the mentor', async () => {
      const result = await mentorshipService.requestMentorship('mentee', 'mentor', { message: '  Hi!  ' });
      expect(prismaMock.mentorshipRequest.create.mock.calls[0][0].data).toEqual({
        menteeId: 'mentee',
        mentorId: 'mentor',
        profileId: 'p1',
        message: 'Hi!',
      });
      expect(result.id).toBe('r9');
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'mentor', type: 'MENTORSHIP_REQUEST', metadata: { requestId: 'r9' } })
      );
    });

    it('checks for an existing PENDING or ACCEPTED request in one query', async () => {
      await mentorshipService.requestMentorship('mentee', 'mentor', {});
      expect(prismaMock.mentorshipRequest.findFirst).toHaveBeenCalledWith({
        where: { menteeId: 'mentee', mentorId: 'mentor', status: { in: ['PENDING', 'ACCEPTED'] } },
      });
    });

    it('cannot request yourself', async () => {
      await expect(mentorshipService.requestMentorship('mentor', 'mentor', {})).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.mentorProfile.findUnique).not.toHaveBeenCalled();
    });

    it('404s when the mentor has no profile or is deactivated as a user', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.requestMentorship('mentee', 'ghost', {})).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile({ user: { isActive: false } }));
      await expect(mentorshipService.requestMentorship('mentee', 'mentor', {})).rejects.toMatchObject({ statusCode: 404 });
    });

    it('requires an active mentor profile', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile({ isActive: false }));
      await expect(mentorshipService.requestMentorship('mentee', 'mentor', {})).rejects.toMatchObject({
        statusCode: 400,
        code: 'MENTOR_INACTIVE',
      });
    });

    it('requires spare capacity', async () => {
      prismaMock.mentorProfile.findUnique.mockResolvedValue(profile({ currentMentees: 3, maxMentees: 3 }));
      await expect(mentorshipService.requestMentorship('mentee', 'mentor', {})).rejects.toMatchObject({
        statusCode: 400,
        code: 'MENTOR_FULL',
      });
    });

    it('409s on a duplicate pending request', async () => {
      prismaMock.mentorshipRequest.findFirst.mockResolvedValue({ id: 'r1', status: 'PENDING' });
      await expect(mentorshipService.requestMentorship('mentee', 'mentor', {})).rejects.toMatchObject({
        statusCode: 409,
        code: 'REQUEST_EXISTS',
      });
      expect(prismaMock.mentorshipRequest.create).not.toHaveBeenCalled();
    });

    it('409s on an already-active mentorship', async () => {
      prismaMock.mentorshipRequest.findFirst.mockResolvedValue({ id: 'r1', status: 'ACCEPTED' });
      await expect(mentorshipService.requestMentorship('mentee', 'mentor', {})).rejects.toMatchObject({
        statusCode: 409,
        code: 'MENTORSHIP_EXISTS',
      });
    });

    it('rejects a non-string message and survives notification failures', async () => {
      await expect(mentorshipService.requestMentorship('mentee', 'mentor', { message: 5 } as any)).rejects.toMatchObject({
        statusCode: 400,
      });
      notify.mockRejectedValue(new Error('down'));
      await expect(mentorshipService.requestMentorship('mentee', 'mentor', {})).resolves.toMatchObject({ id: 'r9' });
    });
  });

  describe('respondToRequest', () => {
    beforeEach(() => {
      prismaMock.mentorshipRequest.update.mockImplementation(async (args: any) => ({ id: 'r1', ...args.data }));
      prismaMock.mentorProfile.update.mockResolvedValue(profile());
    });

    it('accepting marks ACCEPTED, increments currentMentees and notifies the mentee', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request());

      const result = await mentorshipService.respondToRequest('mentor', 'r1', true);

      expect(result).toEqual({ id: 'r1', status: 'ACCEPTED' });
      expect(prismaMock.mentorProfile.update).toHaveBeenCalledWith({
        where: { id: 'p1' },
        data: { currentMentees: { increment: 1 } },
      });
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'mentee', type: 'MENTORSHIP_ACCEPTED', link: '/mentorship' })
      );
    });

    it('declining marks DECLINED without touching the count', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request());
      const result = await mentorshipService.respondToRequest('mentor', 'r1', false);
      expect(result.status).toBe('DECLINED');
      expect(prismaMock.mentorProfile.update).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'MENTORSHIP_DECLINED', link: undefined }));
    });

    it('only the mentor can respond', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request());
      await expect(mentorshipService.respondToRequest('mentee', 'r1', true)).rejects.toMatchObject({ statusCode: 403 });
      await expect(mentorshipService.respondToRequest('stranger', 'r1', true)).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.mentorshipRequest.update).not.toHaveBeenCalled();
    });

    it('404s for unknown requests', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.respondToRequest('mentor', 'nope', true)).rejects.toMatchObject({ statusCode: 404 });
    });

    it.each(['ACCEPTED', 'DECLINED', 'COMPLETED'])('refuses to re-process a %s request', async (status) => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request({ status }));
      await expect(mentorshipService.respondToRequest('mentor', 'r1', true)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('refuses to accept beyond capacity (but declining is fine)', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(
        request({ profile: profile({ currentMentees: 3, maxMentees: 3 }) })
      );
      await expect(mentorshipService.respondToRequest('mentor', 'r1', true)).rejects.toMatchObject({
        statusCode: 400,
        code: 'MENTOR_FULL',
      });
      await expect(mentorshipService.respondToRequest('mentor', 'r1', false)).resolves.toMatchObject({ status: 'DECLINED' });
    });

    it('requires a boolean accept flag (string "false" must not accept)', async () => {
      await expect(mentorshipService.respondToRequest('mentor', 'r1', 'false' as any)).rejects.toMatchObject({
        statusCode: 400,
      });
      await expect(mentorshipService.respondToRequest('mentor', 'r1', undefined as any)).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(prismaMock.mentorshipRequest.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getMyMentorshipRequests', () => {
    beforeEach(() => prismaMock.mentorshipRequest.findMany.mockResolvedValue([request()]));

    it('scopes to the mentor side', async () => {
      await mentorshipService.getMyMentorshipRequests('mentor', 'mentor');
      expect(prismaMock.mentorshipRequest.findMany.mock.calls[0][0].where).toEqual({ mentorId: 'mentor' });
    });

    it('scopes to the mentee side with a normalized status filter', async () => {
      await mentorshipService.getMyMentorshipRequests('mentee', 'mentee', 'accepted');
      expect(prismaMock.mentorshipRequest.findMany.mock.calls[0][0].where).toEqual({ menteeId: 'mentee', status: 'ACCEPTED' });
    });

    it('rejects an unknown status filter', async () => {
      await expect(mentorshipService.getMyMentorshipRequests('mentee', 'mentee', 'WHATEVER')).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });

  describe('scheduleSession', () => {
    const when = () => inDays(2).toISOString();

    beforeEach(() => {
      prismaMock.mentorshipSession.create.mockImplementation(async (args: any) => ({ id: 's1', ...args.data }));
    });

    it.each([
      ['mentor', 'mentee', 'Maya Mentor'],
      ['mentee', 'mentor', 'Manu Mentee'],
    ])('lets the %s schedule and notifies the other party', async (actor, other, name) => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request({ status: 'ACCEPTED' }));
      const scheduledAt = when();
      const result = await mentorshipService.scheduleSession(actor, 'r1', { scheduledAt, notes: 'Agenda' });
      expect(result).toEqual({ id: 's1', requestId: 'r1', scheduledAt: new Date(scheduledAt), notes: 'Agenda' });
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: other, type: 'MENTORSHIP_SESSION', message: expect.stringContaining(name) })
      );
    });

    it('403s for non-participants (before revealing status)', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request({ status: 'DECLINED' }));
      await expect(mentorshipService.scheduleSession('stranger', 'r1', { scheduledAt: when() })).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it.each(['PENDING', 'DECLINED', 'COMPLETED'])('refuses sessions on %s requests', async (status) => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request({ status }));
      await expect(mentorshipService.scheduleSession('mentor', 'r1', { scheduledAt: when() })).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_STATUS',
      });
      expect(prismaMock.mentorshipSession.create).not.toHaveBeenCalled();
    });

    it('404s for unknown requests', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.scheduleSession('mentor', 'nope', { scheduledAt: when() })).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it.each([
      ['in the past', inDays(-1).toISOString()],
      ['invalid', 'tomorrow-ish'],
      ['missing', undefined],
    ])('rejects a scheduledAt that is %s', async (_label, scheduledAt) => {
      await expect(
        mentorshipService.scheduleSession('mentor', 'r1', { scheduledAt } as any)
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.mentorshipRequest.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('completeSession', () => {
    const session = (overrides: Record<string, unknown> = {}) => ({
      id: 's1',
      completed: false,
      request: { mentorId: 'mentor', menteeId: 'mentee' },
      ...overrides,
    });

    it('lets the mentor complete a session with outcomes', async () => {
      prismaMock.mentorshipSession.findUnique.mockResolvedValue(session());
      prismaMock.mentorshipSession.update.mockResolvedValue({ id: 's1', completed: true });
      await mentorshipService.completeSession('mentor', 's1', 'Great progress');
      expect(prismaMock.mentorshipSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { completed: true, outcomes: 'Great progress' },
      });
    });

    it('forbids the mentee and strangers', async () => {
      prismaMock.mentorshipSession.findUnique.mockResolvedValue(session());
      await expect(mentorshipService.completeSession('mentee', 's1')).rejects.toMatchObject({ statusCode: 403 });
      await expect(mentorshipService.completeSession('stranger', 's1')).rejects.toMatchObject({ statusCode: 403 });
      expect(prismaMock.mentorshipSession.update).not.toHaveBeenCalled();
    });

    it('404s for unknown sessions and refuses double completion', async () => {
      prismaMock.mentorshipSession.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.completeSession('mentor', 'nope')).rejects.toMatchObject({ statusCode: 404 });
      prismaMock.mentorshipSession.findUnique.mockResolvedValue(session({ completed: true }));
      await expect(mentorshipService.completeSession('mentor', 's1')).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getMentorshipSessions', () => {
    it('returns sessions to either participant', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request());
      prismaMock.mentorshipSession.findMany.mockResolvedValue([{ id: 's1' }]);
      await expect(mentorshipService.getMentorshipSessions('r1', 'mentor')).resolves.toEqual([{ id: 's1' }]);
      await expect(mentorshipService.getMentorshipSessions('r1', 'mentee')).resolves.toEqual([{ id: 's1' }]);
      expect(prismaMock.mentorshipSession.findMany).toHaveBeenCalledWith({
        where: { requestId: 'r1' },
        orderBy: { scheduledAt: 'desc' },
      });
    });

    it('403s for strangers and 404s for unknown requests', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request());
      await expect(mentorshipService.getMentorshipSessions('r1', 'stranger')).rejects.toMatchObject({ statusCode: 403 });
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.getMentorshipSessions('nope', 'mentor')).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('endMentorship', () => {
    it('either participant can end an active mentorship; the count decrement is floored at 0', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request({ status: 'ACCEPTED' }));

      await expect(mentorshipService.endMentorship('mentee', 'r1')).resolves.toEqual({
        message: 'Mentorship ended successfully',
      });
      await mentorshipService.endMentorship('mentor', 'r1');

      expect(prismaMock.mentorshipRequest.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { status: 'COMPLETED' } });
      expect(prismaMock.mentorProfile.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', currentMentees: { gt: 0 } },
        data: { currentMentees: { decrement: 1 } },
      });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it('403s for strangers, 404s for unknown, 400s for inactive mentorships', async () => {
      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request({ status: 'ACCEPTED' }));
      await expect(mentorshipService.endMentorship('stranger', 'r1')).rejects.toMatchObject({ statusCode: 403 });

      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(null);
      await expect(mentorshipService.endMentorship('mentor', 'nope')).rejects.toMatchObject({ statusCode: 404 });

      prismaMock.mentorshipRequest.findUnique.mockResolvedValue(request({ status: 'PENDING' }));
      await expect(mentorshipService.endMentorship('mentor', 'r1')).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.mentorProfile.updateMany).not.toHaveBeenCalled();
    });
  });
});
