/**
 * ROUND 2 - single-use secrets under a parallel burst: e-mail verification, password reset, refresh-token rotation,
 * 2FA code, invite acceptance. A token that two concurrent requests can both redeem is a replay window.
 * (These held up in round 2; they are kept as regression coverage.)
 */
import crypto from 'crypto';
import { createUser, http, prisma, PASSWORD, uniqueEmail } from '../../integration/helpers';
import { hashToken } from '../../../src/utils/jwt';
import { twoFactorService } from '../../../src/services/twoFactorService';
import { hashPassword } from '../../../src/utils/password';

afterAll(async () => {
  await prisma.$disconnect();
});

const oneTimeToken = async (userId: string, type: string, ttlMs = 3600_000) => {
  const raw = crypto.randomBytes(32).toString('hex');
  await prisma.verificationToken.create({ data: { userId, token: hashToken(raw), type, expiresAt: new Date(Date.now() + ttlMs) } });
  return raw;
};

describe('single-use tokens cannot be redeemed twice at once', () => {
  it('an e-mail verification token verifies exactly once', async () => {
    const { user } = await createUser('MEMBER', { isVerified: false, emailVerifiedAt: null });
    const token = await oneTimeToken(user.id, 'EMAIL_VERIFY');
    const results = await Promise.all(Array.from({ length: 5 }, () => http().post('/api/auth/verify-email').send({ token, password: PASSWORD })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(4);
  });

  it('a password-reset token sets exactly one password', async () => {
    const { user } = await createUser('MEMBER');
    const token = await oneTimeToken(user.id, 'PASSWORD_RESET');
    const attempts = Array.from({ length: 6 }, (_, i) => `Reset!Passw0rd-${i}-x`);
    const results = await Promise.all(attempts.map((password) => http().post('/api/auth/reset-password').send({ token, password })));
    const winners = results.map((r, i) => ({ r, i })).filter(({ r }) => r.status === 200);
    expect(winners).toHaveLength(1);

    const logins = await Promise.all(
      attempts.map((password) => http().post('/api/auth/login').send({ email: user.email, password }))
    );
    expect(logins.filter((r) => r.status === 200)).toHaveLength(1);
    expect(logins[winners[0].i].status).toBe(200);
  });

  it('one refresh token yields exactly one new session and does not revoke the family', async () => {
    const { user } = await createUser('MEMBER');
    const login = await http().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const refreshToken = login.body.data.refreshToken as string;

    const results = await Promise.all(Array.from({ length: 6 }, () => http().post('/api/auth/refresh-token').send({ refreshToken })));
    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);

    // The loser requests were a lost race, not theft: the winner's token still works
    const next = await http().post('/api/auth/refresh-token').send({ refreshToken: winners[0].body.data.refreshToken });
    expect(next.status).toBe(200);
  });

  it('a 2FA code is redeemed once even when guessed correctly in parallel', async () => {
    const { user } = await createUser('MEMBER', { twoFactorEnabled: true });
    const hash = (twoFactorService as unknown as { hashOTP: (u: string, o: string) => string }).hashOTP(user.id, '123456');
    await prisma.verificationToken.create({ data: { userId: user.id, token: hash, type: 'TWO_FACTOR', expiresAt: new Date(Date.now() + 600_000) } });
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => twoFactorService.verifyOTP(user.id, '123456')));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it('a direct invitation is accepted once; a shareable link by several members at once creates one connection each', async () => {
    const inviter = await createUser('MEMBER');
    const invitee = await createUser('MEMBER');
    const token = crypto.randomBytes(32).toString('hex');
    await prisma.invite.create({
      data: { email: invitee.user.email, token, expiresAt: new Date(Date.now() + 86400000), inviterId: inviter.user.id, status: 'SENT' },
    });
    const direct = await Promise.all(Array.from({ length: 5 }, () => http().post(`/api/invites/${token}/accept`).set('Authorization', invitee.auth)));
    expect(direct.filter((r) => r.status === 200)).toHaveLength(1);
    expect(direct.some((r) => r.status >= 500)).toBe(false);

    const link = await http().post('/api/invites/generate-link').set('Authorization', inviter.auth);
    const shareToken = new URL(link.body.data.link).searchParams.get('ref')!;
    const members = await Promise.all(Array.from({ length: 5 }, () => createUser('MEMBER')));
    const shared = await Promise.all(members.map((m) => http().post(`/api/invites/${shareToken}/accept`).set('Authorization', m.auth)));
    expect(shared.every((r) => r.status === 200)).toBe(true);
    // the same member twice at once: never a server error, never two connection rows
    const twice = await Promise.all(Array.from({ length: 4 }, () => http().post(`/api/invites/${shareToken}/accept`).set('Authorization', members[0].auth)));
    expect(twice.some((r) => r.status >= 500)).toBe(false);
    const pair = await prisma.connection.count({
      where: { OR: [{ requesterId: inviter.user.id, addresseeId: members[0].user.id }, { requesterId: members[0].user.id, addresseeId: inviter.user.id }] },
    });
    expect(pair).toBe(1);
  });
});

describe('password handling at the byte boundary and per-account guess budgets', () => {
  const email = () => uniqueEmail('policy');
  const register = (password: string) =>
    http().post('/api/auth/register').send({
      email: email(),
      password,
      fullName: 'Policy Tester',
      batchYear: 2015,
      department: 'Computer Engineering',
      degree: 'B.E.',
    });

  it('72 bytes of multi-byte characters is accepted, 75 is refused with a clear code (no silent truncation)', async () => {
    const ok = 'Aa1' + '€'.repeat(23); // 3 + 69 = 72 bytes
    const tooLong = 'Aa1' + '€'.repeat(24); // 75 bytes
    expect(Buffer.byteLength(ok)).toBe(72);
    expect((await register(ok)).status).toBe(201);
    const refused = await register(tooLong);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('PASSWORD_TOO_LONG');
  });

  it('a wrong-password burst on one account never spends another account\'s budget', async () => {
    const victim = await createUser('MEMBER');
    const attacker = await createUser('MEMBER');
    for (let i = 0; i < 7; i++) {
      await http().post('/api/auth/change-password').set('Authorization', attacker.auth).send({ currentPassword: 'Wrong!Passw0rd1', newPassword: 'Another!Passw0rd9' });
    }
    const attackerLocked = await http()
      .post('/api/auth/change-password')
      .set('Authorization', attacker.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'Another!Passw0rd9' });
    expect(attackerLocked.status).toBe(429);

    // the victim, same IP, is unaffected and can still confirm their password
    const victimOk = await http()
      .post('/api/auth/change-password')
      .set('Authorization', victim.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'Victim!NewPassw0rd7' });
    expect(victimOk.status).toBe(200);
  });

  it('guesses at somebody else\'s 2FA login challenge cannot lock the owner out of password confirmation', async () => {
    const owner = await createUser('MEMBER', { twoFactorEnabled: true, passwordHash: await hashPassword(PASSWORD) });
    // 2FA attempts are budgeted under their own bucket
    for (let i = 0; i < 6; i++) await twoFactorService.verifyOTP(owner.user.id, '000000').catch(() => undefined);
    const res = await http()
      .post('/api/auth/change-password')
      .set('Authorization', owner.auth)
      .send({ currentPassword: PASSWORD, newPassword: 'Owner!NewPassw0rd8' });
    expect(res.status).toBe(200);
  });
});

describe('R2-09 connection requests between the same two people', () => {
  it('A->B and B->A sent at the same moment leave one connection row, not two', async () => {
    for (let round = 0; round < 3; round++) {
      const a = await createUser('MEMBER');
      const b = await createUser('MEMBER');
      const results = await Promise.all([
        http().post(`/api/network/request/${b.user.id}`).set('Authorization', a.auth),
        http().post(`/api/network/request/${a.user.id}`).set('Authorization', b.auth),
      ]);
      expect(results.some((r) => r.status >= 500)).toBe(false);
      const rows = await prisma.connection.findMany({
        where: { OR: [{ requesterId: a.user.id, addresseeId: b.user.id }, { requesterId: b.user.id, addresseeId: a.user.id }] },
      });
      expect(rows).toHaveLength(1);
    }
  });

  it('the same request submitted repeatedly in parallel creates one row and never a server error', async () => {
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const results = await Promise.all(Array.from({ length: 6 }, () => http().post(`/api/network/request/${b.user.id}`).set('Authorization', a.auth)));
    expect(results.some((r) => r.status >= 500)).toBe(false);
    expect(results.filter((r) => r.status === 200 || r.status === 201)).toHaveLength(1);
    expect(await prisma.connection.count({ where: { requesterId: a.user.id, addresseeId: b.user.id } })).toBe(1);
  });
});
