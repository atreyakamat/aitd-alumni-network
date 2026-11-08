/**
 * ROUND 2 - per-account quotas must hold at EXACTLY N under a parallel burst (AU-07 message requests, AU-09 invites).
 * Both limits were "count the rows, then insert": every request of a burst reads the same low count.
 */
import { randomBytes } from 'crypto';
import { createUser, http, prisma } from '../../integration/helpers';
import { MAX_MESSAGE_REQUESTS_PER_DAY } from '../../../src/services/messageService';
import { INVITE_DAILY_LIMIT } from '../../../src/services/inviteService';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('R2-05 message request quota (20 per day) holds under a parallel burst', () => {
  it('30 simultaneous requests to 30 different strangers create at most the daily maximum', async () => {
    const sender = await createUser('MEMBER');
    const strangers = await Promise.all(Array.from({ length: MAX_MESSAGE_REQUESTS_PER_DAY + 10 }, () => createUser('MEMBER')));
    const results = await Promise.all(
      strangers.map((s) => http().post(`/api/messages/${s.user.id}`).set('Authorization', sender.auth).send({ content: 'hello stranger' }))
    );
    const stored = await prisma.message.count({ where: { senderId: sender.user.id, isRequest: true } });
    expect(stored).toBeLessThanOrEqual(MAX_MESSAGE_REQUESTS_PER_DAY);
    expect(results.filter((r) => r.status === 201 || r.status === 200).length).toBe(stored);
    expect(results.filter((r) => r.status === 429).length).toBe(strangers.length - stored);
    expect(results.some((r) => r.status >= 500)).toBe(false);
  });

  it('6 simultaneous messages to the SAME stranger leave exactly one pending request', async () => {
    const sender = await createUser('MEMBER');
    const stranger = await createUser('MEMBER');
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        http().post(`/api/messages/${stranger.user.id}`).set('Authorization', sender.auth).send({ content: `spam ${i}` })
      )
    );
    expect(await prisma.message.count({ where: { senderId: sender.user.id, receiverId: stranger.user.id } })).toBe(1);
    expect(results.filter((r) => r.status === 201 || r.status === 200)).toHaveLength(1);
    expect(results.some((r) => r.status >= 500)).toBe(false);
  });
});

describe('R2-06 invitations: the daily quota and the one-invite-per-address rule hold under a parallel burst', () => {
  const seedInvites = async (inviterId: string, count: number) => {
    await prisma.invite.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        email: `seed.${inviterId}.${i}@aitd.test`,
        token: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 86400000),
        inviterId,
        status: 'SENT',
      })),
    });
  };

  it('parallel single invites cannot push a member past the daily limit', async () => {
    const inviter = await createUser('MEMBER');
    await seedInvites(inviter.user.id, INVITE_DAILY_LIMIT - 1); // exactly one invitation left
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        http().post('/api/invites/send').set('Authorization', inviter.auth).send({ email: `burst.${Date.now()}.${i}@aitd.test` })
      )
    );
    const total = await prisma.invite.count({ where: { inviterId: inviter.user.id, isShareable: false } });
    expect(total).toBeLessThanOrEqual(INVITE_DAILY_LIMIT);
    expect(results.some((r) => r.status >= 500)).toBe(false);
  });

  it('parallel bulk invites cannot exceed the daily limit either', async () => {
    const inviter = await createUser('MEMBER');
    const batch = (tag: string) => Array.from({ length: 50 }, (_, i) => ({ email: `bulk.${tag}.${Date.now()}.${i}@aitd.test` }));
    const results = await Promise.all(
      ['a', 'b', 'c'].map((tag) => http().post('/api/invites/bulk').set('Authorization', inviter.auth).send({ invites: batch(tag) }))
    );
    const total = await prisma.invite.count({ where: { inviterId: inviter.user.id, isShareable: false } });
    expect(total).toBeLessThanOrEqual(INVITE_DAILY_LIMIT);
    expect(results.some((r) => r.status >= 500)).toBe(false);
  }, 120000);

  it('8 simultaneous invites to one address create one invitation (one e-mail), not eight', async () => {
    const inviter = await createUser('MEMBER');
    const email = `target.${Date.now()}@aitd.test`;
    const results = await Promise.all(
      Array.from({ length: 8 }, () => http().post('/api/invites/send').set('Authorization', inviter.auth).send({ email }))
    );
    expect(await prisma.invite.count({ where: { email } })).toBe(1);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
  });

  it('R2-07 invitation addresses are strict: nothing that a mailer would read as several or different recipients', async () => {
    const inviter = await createUser('MEMBER');
    const hostile = [
      'a@b.com,c.d',
      'x,y@b.com',
      'evil@x.com;bcc.d',
      'a@b.com>,<evil.d',
      'a(comment)@b.com',
      'Victim<v@x.com>.a',
      '"a@b.com,c"@d.com',
      'a@b.com\r\nBcc: x@y.com',
      'a@b.com%0d%0aBcc:x@y.com',
    ];
    for (const email of hostile) {
      const res = await http().post('/api/invites/send').set('Authorization', inviter.auth).send({ email });
      expect({ email, status: res.status }).toEqual({ email, status: 400 });
    }
    expect(await prisma.invite.count({ where: { inviterId: inviter.user.id } })).toBe(0);
  });

  it('ordinary addresses (plus tags, dots, subdomains) are still accepted', async () => {
    const inviter = await createUser('MEMBER');
    const stamp = Date.now();
    for (const email of [`first.last+tag.${stamp}@mail.example.co.in`, `o'brien.${stamp}@example.org`]) {
      const res = await http().post('/api/invites/send').set('Authorization', inviter.auth).send({ email });
      expect({ email, status: res.status }).toEqual({ email, status: 201 });
    }
  });
});
