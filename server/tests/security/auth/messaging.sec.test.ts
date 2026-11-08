/**
 * AU-07: messaging must honour blocks, validate media references and cap message-request
 * fan-out. A BLOCKED connection row used to be ignored by sendMessage (a blocked user could
 * still deliver "message requests" - and, after an accepted request, plain messages - to the
 * blocker), `mediaUrl` was stored verbatim (javascript: / data: URLs, unbounded length), and
 * one user could open an unlimited number of message requests to strangers.
 */
import { createUser, http, prisma, uniqueEmail } from '../../integration/helpers';
import { MAX_MESSAGE_REQUESTS_PER_DAY } from '../../../src/services/messageService';

afterAll(async () => {
  await prisma.$disconnect();
});

const connect = (requesterId: string, addresseeId: string, status: 'ACCEPTED' | 'BLOCKED' = 'ACCEPTED') =>
  prisma.connection.create({ data: { requesterId, addresseeId, status } });

describe('AU-07: blocks are enforced for messaging', () => {
  it('rejects a message request from a user the recipient has blocked (either direction)', async () => {
    const blocker = await createUser('MEMBER');
    const blocked = await createUser('MEMBER');
    await connect(blocker.user.id, blocked.user.id, 'BLOCKED');

    const fromBlocked = await http()
      .post(`/api/messages/${blocker.user.id}`)
      .set('Authorization', blocked.auth)
      .send({ content: 'hello?' });
    expect(fromBlocked.status).toBe(403);
    expect(fromBlocked.body.error.code).toBe('BLOCKED');

    const fromBlocker = await http()
      .post(`/api/messages/${blocked.user.id}`)
      .set('Authorization', blocker.auth)
      .send({ content: 'hello?' });
    expect(fromBlocker.status).toBe(403);

    expect(
      await prisma.message.count({ where: { OR: [{ senderId: blocker.user.id }, { senderId: blocked.user.id }] } })
    ).toBe(0);
  });

  it('a previously accepted message request does not survive a block', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    await prisma.message.create({
      data: { senderId: a.user.id, receiverId: b.user.id, content: 'old', isRequest: true, requestStatus: 'ACCEPTED' },
    });
    await connect(b.user.id, a.user.id, 'BLOCKED');

    const res = await http()
      .post(`/api/messages/${b.user.id}`)
      .set('Authorization', a.auth)
      .send({ content: 'still here' });
    expect(res.status).toBe(403);
  });
});

describe('AU-07: media references', () => {
  it('rejects dangerous or oversized mediaUrl values and keeps safe ones', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    await connect(a.user.id, b.user.id);
    const send = (mediaUrl: string) =>
      http().post(`/api/messages/${b.user.id}`).set('Authorization', a.auth).send({ content: 'pic', mediaUrl });

    const bad = [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'java\tscript:alert(1)',
      `https://x.test/${'a'.repeat(3000)}`,
    ];
    for (const value of bad) {
      const res = await send(value);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_URL');
    }
    expect((await send('https://cdn.test/a.png')).status).toBe(201);
    expect((await send('/uploads/messages/a.png')).status).toBe(201);
  });
});

describe('AU-07: message-request fan-out', () => {
  it('caps new message requests per sender per day', async () => {
    const sender = await createUser('MEMBER');
    const strangers = await Promise.all(
      Array.from({ length: MAX_MESSAGE_REQUESTS_PER_DAY + 1 }, () =>
        prisma.user.create({
          data: { email: uniqueEmail('stranger'), fullName: 'Stranger', batchYear: 2010, department: 'X', degree: 'Y' },
        })
      )
    );
    await prisma.message.createMany({
      data: strangers.slice(0, MAX_MESSAGE_REQUESTS_PER_DAY).map((s) => ({
        senderId: sender.user.id,
        receiverId: s.id,
        content: 'spam',
        isRequest: true,
        requestStatus: 'PENDING',
      })),
    });

    const res = await http()
      .post(`/api/messages/${strangers[MAX_MESSAGE_REQUESTS_PER_DAY].id}`)
      .set('Authorization', sender.auth)
      .send({ content: 'one more' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('MESSAGE_REQUEST_LIMIT');
  });
});
