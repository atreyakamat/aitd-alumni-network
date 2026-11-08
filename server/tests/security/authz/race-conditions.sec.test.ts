/**
 * AUTHZ security suite: business-logic races (TOCTOU) on capacity/uniqueness invariants.
 *
 * Each test asserts the SECURE behaviour. A failing test here is a confirmed
 * vulnerability; a passing test documents a control that is correctly enforced.
 */
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AUTHZ: capacity races', () => {
  /**
   * CONFIRMED (AZ-01): eventService.rsvpEvent (src/services/eventService.ts) reads
   * `event.rsvpCount`/`capacity` in one query, then creates the RSVP and increments the
   * counter in a *separate* transaction. Concurrent RSVPs all read the same pre-increment
   * snapshot and all pass the capacity check, so a capacity=1 event accepts every concurrent
   * RSVP (reproduced live: 6/6 concurrent requests succeeded against a capacity=1 event).
   */
  it('never lets RSVPs exceed an event\'s capacity under concurrent requests', async () => {
    const admin = await createUser('ADMIN');
    const attendees = await Promise.all(Array.from({ length: 6 }, () => createUser('MEMBER')));

    const event = await prisma.event.create({
      data: {
        title: 'Capacity race test',
        description: 'd',
        startDate: new Date(Date.now() + 86400000),
        createdById: admin.user.id,
        status: 'PUBLISHED',
        capacity: 1,
      },
    });

    const results = await Promise.all(
      attendees.map((a) => http().post(`/api/events/${event.id}/rsvp`).set('Authorization', a.auth))
    );
    const succeeded = results.filter((r) => r.status === 200 && r.body?.data?.rsvped === true);

    const finalCount = await prisma.eventRSVP.count({ where: { eventId: event.id } });
    expect(finalCount).toBeLessThanOrEqual(1);
    expect(succeeded.length).toBeLessThanOrEqual(1);
  });

  /**
   * CONFIRMED (AZ-02): mentorshipService.respondToRequest (src/services/mentorshipService.ts)
   * reads `request.profile.currentMentees`/`maxMentees` from a pre-fetched snapshot, then
   * accepts and increments in a transaction. Concurrent accepts of distinct pending requests
   * for the same mentor all read the same stale snapshot and all pass the capacity check
   * (reproduced live: 6/7 concurrent accepts succeeded for a mentor with maxMentees=1).
   */
  it('never lets accepted mentees exceed a mentor\'s maxMentees under concurrent accepts', async () => {
    const mentor = await createUser('MEMBER');
    await http().post('/api/mentorship/profile').set('Authorization', mentor.auth).send({ focusAreas: ['Career'], maxMentees: 1 });

    const mentees = await Promise.all(Array.from({ length: 6 }, () => createUser('MEMBER')));
    const requests = await Promise.all(
      mentees.map((m) => http().post(`/api/mentorship/request/${mentor.user.id}`).set('Authorization', m.auth).send({ message: 'hi' }))
    );
    const requestIds = requests.map((r) => r.body.data.id);

    const accepts = await Promise.all(
      requestIds.map((id) => http().post(`/api/mentorship/request/${id}/respond`).set('Authorization', mentor.auth).send({ accept: true }))
    );
    const accepted = accepts.filter((r) => r.status === 200);

    const profile = await prisma.mentorProfile.findUnique({ where: { userId: mentor.user.id } });
    expect(profile!.currentMentees).toBeLessThanOrEqual(1);
    expect(accepted.length).toBeLessThanOrEqual(1);
  });

  it('a connection request cannot be double-accepted by concurrent requests to end up over-counted', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const sent = await http().post(`/api/network/request/${b.user.id}`).set('Authorization', a.auth);
    const connectionId = sent.body.data.connectionId;

    const results = await Promise.all(
      Array.from({ length: 5 }, () => http().post(`/api/network/respond/${connectionId}`).set('Authorization', b.auth).send({ accept: true }))
    );
    const succeeded = results.filter((r) => r.status === 200);
    expect(succeeded.length).toBe(1);

    const connections = await prisma.connection.count({ where: { id: connectionId } });
    expect(connections).toBe(1); // exactly one row, not duplicated
  });
});
