/**
 * ROUND 3 / A2 (R3-07) - notification spam. One member must not be able to fill another member's notification list (and, through the
 * Kafka bus, their mailbox and the topic) by repeating a cheap action: follow/unfollow, react/unreact, RSVP/cancel, comment/delete,
 * edit a comment so that a mention comes and goes, send message after message, ask for mentorship again after every decline.
 *
 * The rule (socialNotifications.notifyOnce): per (recipient, type, actor, subject) one notification per cooldown window; the
 * ACTION itself always goes through. A second actor is a different key and is notified normally.
 */
import { createUser, http, prisma } from '../../integration/helpers';
import { resetNotificationCooldowns } from '../../../src/services/socialNotifications';

afterAll(async () => {
  await prisma.$disconnect();
});

const count = (userId: string, type: string) => prisma.notification.count({ where: { userId, type: type as never } });
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

describe('loops that used to notify every time', () => {
  it('follow / unfollow x5: one NEW_FOLLOWER', async () => {
    const actor = await createUser('MEMBER');
    const target = await createUser('MEMBER');
    for (let i = 0; i < 5; i++) {
      expect((await http().post(`/api/users/${target.user.id}/follow`).set('Authorization', actor.auth)).status).toBeLessThan(300);
      await http().delete(`/api/users/${target.user.id}/follow`).set('Authorization', actor.auth);
    }
    expect(await count(target.user.id, 'NEW_FOLLOWER')).toBe(1);
  });

  it('react / unreact x5 on a post and on a comment: one notification each', async () => {
    const actor = await createUser('MEMBER');
    const author = await createUser('MEMBER');
    const post = await prisma.post.create({ data: { userId: author.user.id, content: 'r3 notify post' } });
    const comment = await prisma.postComment.create({ data: { postId: post.id, userId: author.user.id, content: 'r3 notify comment' } });
    for (let i = 0; i < 5; i++) {
      await http().post(`/api/posts/${post.id}/react`).set('Authorization', actor.auth).send({ type: 'LIKE' });
      await http().post(`/api/posts/${post.id}/react`).set('Authorization', actor.auth).send({ type: 'LIKE' }); // toggles off
      await http().post(`/api/comments/${comment.id}/react`).set('Authorization', actor.auth).send({ type: 'LIKE' });
      await http().post(`/api/comments/${comment.id}/react`).set('Authorization', actor.auth).send({ type: 'LIKE' });
    }
    const all = await prisma.notification.findMany({ where: { userId: author.user.id } });
    const byType = (t: string) => all.filter((n) => n.type === t).length;
    expect(byType('POST_REACTED')).toBe(1);
    expect(all.length).toBeLessThanOrEqual(2);
  });

  it('RSVP / cancel x5: the organiser is told once', async () => {
    const organiser = await createUser('CHAPTER_ADMIN');
    const attendee = await createUser('MEMBER');
    const event = await prisma.event.create({
      data: { title: 'r3 meetup', description: 'd', eventType: 'OFFLINE', status: 'PUBLISHED', isPublic: true, startDate: inDays(7), createdById: organiser.user.id },
    });
    for (let i = 0; i < 6; i++) {
      expect((await http().post(`/api/events/${event.id}/rsvp`).set('Authorization', attendee.auth)).status).toBe(200);
    }
    expect(await count(organiser.user.id, 'EVENT_RSVP')).toBe(1);
  });

  it('comment / delete x5 on somebody else\'s post: the author is told once', async () => {
    const actor = await createUser('MEMBER');
    const author = await createUser('MEMBER');
    const post = await prisma.post.create({ data: { userId: author.user.id, content: 'r3 comment loop' } });
    for (let i = 0; i < 5; i++) {
      const res = await http().post(`/api/posts/${post.id}/comments`).set('Authorization', actor.auth).send({ content: `spam ${i}` });
      expect(res.status).toBe(201);
      await http().delete(`/api/comments/${res.body.data.id}`).set('Authorization', actor.auth);
    }
    expect(await count(author.user.id, 'POST_COMMENTED')).toBe(1);
  });

  it('a mention that is removed and added again by editing a comment notifies once', async () => {
    const actor = await createUser('MEMBER');
    const author = await createUser('MEMBER');
    const victim = await createUser('MEMBER');
    const post = await prisma.post.create({ data: { userId: author.user.id, content: 'r3 mention loop' } });
    const created = await http().post(`/api/posts/${post.id}/comments`).set('Authorization', actor.auth).send({ content: 'hi', mentionIds: [victim.user.id] });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    for (let i = 0; i < 5; i++) {
      await http().patch(`/api/comments/${id}`).set('Authorization', actor.auth).send({ content: `without ${i}`, mentionIds: [] });
      await http().patch(`/api/comments/${id}`).set('Authorization', actor.auth).send({ content: `with ${i}`, mentionIds: [victim.user.id] });
    }
    expect(await count(victim.user.id, 'MENTION')).toBe(1);
  });

  it('a mention that is removed and added again by editing a post notifies once', async () => {
    const actor = await createUser('MEMBER');
    const victim = await createUser('MEMBER');
    const created = await http().post('/api/posts').set('Authorization', actor.auth).send({ content: 'hello', mentionIds: [victim.user.id] });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    for (let i = 0; i < 5; i++) {
      await http().patch(`/api/posts/${id}`).set('Authorization', actor.auth).send({ content: `without ${i}`, mentionIds: [] });
      await http().patch(`/api/posts/${id}`).set('Authorization', actor.auth).send({ content: `with ${i}`, mentionIds: [victim.user.id] });
    }
    expect(await count(victim.user.id, 'MENTION')).toBe(1);
  });

  it('message after message from one sender: the recipient gets one notification per cooldown, every message is still delivered', async () => {
    const sender = await createUser('MEMBER');
    const receiver = await createUser('MEMBER');
    await prisma.connection.create({ data: { requesterId: sender.user.id, addresseeId: receiver.user.id, status: 'ACCEPTED' } });
    for (let i = 0; i < 8; i++) {
      expect((await http().post(`/api/messages/${receiver.user.id}`).set('Authorization', sender.auth).send({ content: `hello ${i}` })).status).toBe(201);
    }
    expect(await prisma.message.count({ where: { senderId: sender.user.id, receiverId: receiver.user.id } })).toBe(8);
    expect(await count(receiver.user.id, 'MESSAGE_RECEIVED')).toBe(1);
    const unread = await http().get('/api/messages/unread').set('Authorization', receiver.auth);
    expect(JSON.stringify(unread.body)).toContain('8'); // the badge still counts every message
  });

  it('asking for mentorship again after each decline: the mentor is told once', async () => {
    const mentor = await createUser('MEMBER');
    const mentee = await createUser('MEMBER');
    await prisma.mentorProfile.create({ data: { userId: mentor.user.id, focusAreas: ['Career'], maxMentees: 5 } });
    for (let i = 0; i < 4; i++) {
      const asked = await http().post(`/api/mentorship/request/${mentor.user.id}`).set('Authorization', mentee.auth).send({ message: `please ${i}` });
      expect(asked.status).toBe(201);
      const declined = await http().post(`/api/mentorship/request/${asked.body.data.id}/respond`).set('Authorization', mentor.auth).send({ accept: false });
      expect(declined.status).toBe(200);
    }
    expect(await count(mentor.user.id, 'MENTORSHIP_REQUEST')).toBe(1);
  });
});

describe('the cooldown is per actor and per subject, and never blocks the action', () => {
  it('a second member, and a different post, are notified normally', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const author = await createUser('MEMBER');
    const p1 = await prisma.post.create({ data: { userId: author.user.id, content: 'one' } });
    const p2 = await prisma.post.create({ data: { userId: author.user.id, content: 'two' } });
    await http().post(`/api/posts/${p1.id}/react`).set('Authorization', a.auth).send({ type: 'LIKE' });
    await http().post(`/api/posts/${p1.id}/react`).set('Authorization', b.auth).send({ type: 'LIKE' });
    await http().post(`/api/posts/${p2.id}/react`).set('Authorization', a.auth).send({ type: 'LIKE' });
    expect(await count(author.user.id, 'POST_REACTED')).toBe(3);
  });

  it('a parallel burst of the same action still produces one notification (the check is not only check-then-act)', async () => {
    const actor = await createUser('MEMBER');
    const author = await createUser('MEMBER');
    const post = await prisma.post.create({ data: { userId: author.user.id, content: 'r3 burst' } });
    const burst = await Promise.all(
      Array.from({ length: 8 }, (_, i) => http().post(`/api/posts/${post.id}/comments`).set('Authorization', actor.auth).send({ content: `burst ${i}` }))
    );
    expect(burst.every((r) => r.status === 201)).toBe(true);
    expect(await prisma.postComment.count({ where: { postId: post.id } })).toBe(8);
    expect(await count(author.user.id, 'POST_COMMENTED')).toBe(1);
  });

  it('after the window has passed the same actor is notified again', async () => {
    const actor = await createUser('MEMBER');
    const target = await createUser('MEMBER');
    await http().post(`/api/users/${target.user.id}/follow`).set('Authorization', actor.auth);
    await http().delete(`/api/users/${target.user.id}/follow`).set('Authorization', actor.auth);
    await prisma.notification.updateMany({ where: { userId: target.user.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    resetNotificationCooldowns(); // the in-process layer ends with the window too; here a restart stands in for 25 hours
    await http().post(`/api/users/${target.user.id}/follow`).set('Authorization', actor.auth);
    expect(await count(target.user.id, 'NEW_FOLLOWER')).toBe(2);
  });
});
