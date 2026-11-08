/**
 * Concurrency / capacity guarantees against a real PostgreSQL database.
 *
 * These exercise the atomic guards added to eventService.rsvpEvent and
 * mentorshipService.respondToRequest: because the checks run inside the write
 * (a capacity-guarded UPDATE), two racing requests for the last slot can never
 * both win. The mocked unit tests cannot prove this — only a real DB can.
 */
import { createUser, http, prisma } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

describe('event RSVP capacity under concurrency', () => {
  it('never overbooks the last seat when two members RSVP at once', async () => {
    const creator = await createUser('ADMIN');
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');

    const event = await prisma.event.create({
      data: {
        title: 'Capacity Meetup',
        description: 'One seat only',
        eventType: 'OFFLINE',
        status: 'PUBLISHED',
        isPublic: true,
        capacity: 1,
        startDate: inDays(7),
        createdById: creator.user.id,
      },
    });

    const rsvp = (u: Awaited<ReturnType<typeof createUser>>) =>
      http().post(`/api/events/${event.id}/rsvp`).set('Authorization', u.auth);

    const results = await Promise.all([rsvp(a), rsvp(b)]);
    const statuses = results.map((r) => r.status).sort((x, y) => x - y);

    // Exactly one booking succeeds; the other is told the event is full.
    expect(statuses).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body?.error?.code).toBe('EVENT_FULL');

    const stored = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(stored.rsvpCount).toBe(1);
    expect(await prisma.eventRSVP.count({ where: { eventId: event.id } })).toBe(1);
  });
});

describe('mentorship capacity under concurrency', () => {
  it('never exceeds maxMentees when a mentor accepts two requests at once', async () => {
    const mentor = await createUser('MEMBER');
    const mentee1 = await createUser('MEMBER');
    const mentee2 = await createUser('MEMBER');

    const profile = await prisma.mentorProfile.create({
      data: { userId: mentor.user.id, focusAreas: ['Careers'], maxMentees: 1, currentMentees: 0, isActive: true },
    });

    const request = async (mentee: Awaited<ReturnType<typeof createUser>>) => {
      const res = await http()
        .post(`/api/mentorship/request/${mentor.user.id}`)
        .set('Authorization', mentee.auth)
        .send({ message: 'Please mentor me' });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };

    const req1 = await request(mentee1);
    const req2 = await request(mentee2);

    const respond = (requestId: string) =>
      http().post(`/api/mentorship/request/${requestId}/respond`).set('Authorization', mentor.auth).send({ accept: true });

    const results = await Promise.all([respond(req1), respond(req2)]);
    const statuses = results.map((r) => r.status).sort((x, y) => x - y);

    // One accept wins; the other is rejected for capacity and rolled back to PENDING.
    expect(statuses).toEqual([200, 400]);
    expect(results.find((r) => r.status === 400)?.body?.error?.code).toBe('MENTOR_FULL');

    const stored = await prisma.mentorProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(stored.currentMentees).toBe(1);

    const accepted = await prisma.mentorshipRequest.count({ where: { profileId: profile.id, status: 'ACCEPTED' } });
    const pending = await prisma.mentorshipRequest.count({ where: { profileId: profile.id, status: 'PENDING' } });
    expect(accepted).toBe(1);
    expect(pending).toBe(1); // the loser's claim rolled back, leaving it still pending
  });
});
