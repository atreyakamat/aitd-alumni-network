/**
 * GET /api/messages (the conversation list) against a real PostgreSQL.
 *
 * The list shows one row per person a member has talked to: the latest message, how many are unread, newest conversation
 * first. It must stay correct and cheap however long the history is: a member with thousands of messages gets one page of
 * rows back, not their whole history.
 */
import { createUser, http, prisma } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

const say = (from: string, to: string, content: string, minutesAgo: number, extra: Record<string, unknown> = {}) =>
  prisma.message.create({ data: { senderId: from, receiverId: to, content, createdAt: at(minutesAgo), ...extra } });

const conversations = async (auth: string, query = '') => {
  const res = await http().get(`/api/messages${query}`).set('Authorization', auth);
  expect(res.status).toBe(200);
  // { success, data: [...conversations], pagination }
  return { data: res.body.data as any[], pagination: res.body.pagination };
};

describe('the conversation list', () => {
  it('lists one row per person, newest conversation first, with the latest message and the unread count', async () => {
    const me = await createUser('MEMBER');
    const ann = await createUser('MEMBER');
    const bob = await createUser('MEMBER');
    const cy = await createUser('MEMBER');

    await say(me.user.id, ann.user.id, 'hi Ann', 500);
    await say(ann.user.id, me.user.id, 'hello from Ann', 400);
    await say(bob.user.id, me.user.id, 'Bob one', 300);
    await say(bob.user.id, me.user.id, 'Bob two (latest)', 20);
    await say(me.user.id, cy.user.id, 'to Cy (latest overall)', 5);
    await say(ann.user.id, me.user.id, 'Ann again, unread', 100);

    const body = await conversations(me.auth);

    expect(body.data.map((c) => c.partnerId)).toEqual([cy.user.id, bob.user.id, ann.user.id]);
    expect(body.data[0].lastMessage).toMatchObject({ content: 'to Cy (latest overall)', isSent: true });
    expect(body.data[1].lastMessage).toMatchObject({ content: 'Bob two (latest)', isSent: false });
    expect(body.data[2].lastMessage).toMatchObject({ content: 'Ann again, unread', isSent: false });
    expect(body.data.map((c) => c.unreadCount)).toEqual([0, 2, 2]);
    expect(body.data[1].partner).toMatchObject({ id: bob.user.id });
    expect(body.pagination).toMatchObject({ total: 3, page: 1, totalPages: 1 });
  });

  it('only ever shows the member their own conversations', async () => {
    const me = await createUser('MEMBER');
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    await say(a.user.id, b.user.id, 'private between a and b', 10);
    await say(a.user.id, me.user.id, 'for me', 20);

    const body = await conversations(me.auth);
    expect(body.data).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain('private between a and b');
  });

  it('paginates, and a page past the end is empty but still reports the real total', async () => {
    const me = await createUser('MEMBER');
    const others = await Promise.all([1, 2, 3, 4, 5].map(() => createUser('MEMBER')));
    for (const [i, other] of others.entries()) await say(other.user.id, me.user.id, `msg ${i}`, 100 - i * 10);

    const first = await conversations(me.auth, '?page=1&limit=2');
    const second = await conversations(me.auth, '?page=2&limit=2');
    const third = await conversations(me.auth, '?page=3&limit=2');
    const beyond = await conversations(me.auth, '?page=9&limit=2');

    const ids = [...first.data, ...second.data, ...third.data].map((c) => c.partnerId);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(first.pagination).toMatchObject({ total: 5, page: 1, limit: 2, totalPages: 3, hasNextPage: true });
    expect(third.data).toHaveLength(1);
    expect(beyond.data).toEqual([]);
    expect(beyond.pagination).toMatchObject({ total: 5, page: 9 });
  });

  it('a member with no messages gets an empty list', async () => {
    const me = await createUser('MEMBER');
    const body = await conversations(me.auth);
    expect(body.data).toEqual([]);
    expect(body.pagination).toMatchObject({ total: 0 });
  });

  it('stays correct and returns just one page for a long history', async () => {
    const me = await createUser('MEMBER');
    const friend = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    await prisma.message.createMany({
      data: Array.from({ length: 1500 }, (_, i) => ({
        senderId: i % 2 === 0 ? me.user.id : friend.user.id,
        receiverId: i % 2 === 0 ? friend.user.id : me.user.id,
        content: `history ${i}`,
        createdAt: at(10_000 - i),
      })),
    });
    await say(other.user.id, me.user.id, 'newest of all', 1);

    const started = Date.now();
    const body = await conversations(me.auth, '?limit=1');
    const tookMs = Date.now() - started;

    expect(body.data).toHaveLength(1);
    expect(body.data[0].lastMessage.content).toBe('newest of all');
    expect(body.pagination.total).toBe(2);
    expect(tookMs).toBeLessThan(2000);

    const friendRow = (await conversations(me.auth, '?page=2&limit=1')).data[0];
    expect(friendRow.partnerId).toBe(friend.user.id);
    expect(friendRow.lastMessage.content).toBe('history 1499');
  });
});
