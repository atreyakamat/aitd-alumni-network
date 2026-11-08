/**
 * AU-09: invite e-mails are sent from the platform's own sender address with
 * attacker-chosen name/message, to attacker-chosen recipients. Without a per-inviter daily
 * quota and field caps, any account can use /invites/send and /invites/bulk as a spam relay.
 */
import * as email from '../../../src/utils/email';
import { INVITE_DAILY_LIMIT, MAX_INVITE_MESSAGE_LENGTH } from '../../../src/services/inviteService';
import { createUser, http, prisma, uniqueEmail } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => jest.restoreAllMocks());

describe('AU-09: invite abuse limits', () => {
  it('stops sending once the inviter exhausted the daily quota (single and bulk)', async () => {
    const send = jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
    const { user, auth } = await createUser('MEMBER');
    await prisma.invite.createMany({
      data: Array.from({ length: INVITE_DAILY_LIMIT }, (_, i) => ({
        email: `old${i}.${Date.now()}@spam.test`,
        token: `${user.id}-${i}`,
        expiresAt: new Date(Date.now() + 86400000),
        inviterId: user.id,
        status: 'SENT',
      })),
    });

    const single = await http()
      .post('/api/invites/send')
      .set('Authorization', auth)
      .send({ email: uniqueEmail('target') });
    expect(single.status).toBe(429);
    expect(single.body.error.code).toBe('INVITE_LIMIT');

    const bulk = await http()
      .post('/api/invites/bulk')
      .set('Authorization', auth)
      .send({ invites: [{ email: uniqueEmail('t1') }, { email: uniqueEmail('t2') }] });
    expect(bulk.status).toBe(429);

    expect(send).not.toHaveBeenCalled();
  });

  it('rejects oversized custom message / name before any e-mail goes out', async () => {
    const send = jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
    const { auth } = await createUser('MEMBER');

    const longMessage = await http()
      .post('/api/invites/send')
      .set('Authorization', auth)
      .send({ email: uniqueEmail('t'), message: 'x'.repeat(MAX_INVITE_MESSAGE_LENGTH + 1) });
    expect(longMessage.status).toBe(400);

    const longName = await http()
      .post('/api/invites/send')
      .set('Authorization', auth)
      .send({ email: uniqueEmail('t'), name: 'n'.repeat(101) });
    expect(longName.status).toBe(400);

    expect(send).not.toHaveBeenCalled();
  });

  it('invite tokens are 256-bit CSPRNG values, single-use and e-mail bound (verified OK)', async () => {
    jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
    const inviter = await createUser('MEMBER');
    const target = uniqueEmail('invitee');
    const res = await http().post('/api/invites/send').set('Authorization', inviter.auth).send({ email: target });
    expect(res.status).toBe(201);
    const invite = await prisma.invite.findFirstOrThrow({ where: { email: target } });
    expect(invite.token).toMatch(/^[a-f0-9]{64}$/);

    const wrongUser = await createUser('MEMBER');
    const denied = await http().post(`/api/invites/${invite.token}/accept`).set('Authorization', wrongUser.auth);
    expect(denied.status).toBe(403);

    const invitee = await createUser('MEMBER', { email: target });
    const first = await http().post(`/api/invites/${invite.token}/accept`).set('Authorization', invitee.auth);
    expect(first.status).toBe(200);
    const second = await http().post(`/api/invites/${invite.token}/accept`).set('Authorization', invitee.auth);
    expect(second.status).toBe(400);
  });
});
