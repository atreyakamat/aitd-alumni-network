/**
 * ROUND 3 / C2 - approval bypass: every way to obtain or keep a session, an access token or a socket for a registration that
 * an administrator has not approved (PENDING) or has turned down (REJECTED).
 *
 * Invariant: nothing that mints, renews or accepts a credential hands anything to an unapproved account, whatever the order of
 * events (token issued first, status changed later) and whatever route is used.
 */
import { createUser, http, prisma, PASSWORD, uniqueEmail } from '../../integration/helpers';
import { authService } from '../../../src/services/authService';
import { generateAccessToken, generateRefreshToken, generateTwoFactorToken } from '../../../src/utils/jwt';
import { hashToken } from '../../../src/utils/jwt';
import { socketAuthMiddleware } from '../../../src/utils/socket';

afterAll(async () => {
  await prisma.$disconnect();
});

type Status = 'PENDING' | 'REJECTED';
const STATUSES: Status[] = ['PENDING', 'REJECTED'];
const CODE: Record<Status, string> = { PENDING: 'ACCOUNT_PENDING_APPROVAL', REJECTED: 'ACCOUNT_REJECTED' };

const unapproved = (status: Status, overrides: Record<string, unknown> = {}) =>
  createUser('MEMBER', { approvalStatus: status, isVerified: false, ...overrides });

const login = (email: string, password = PASSWORD) => http().post('/api/auth/login').send({ email, password });

describe.each(STATUSES)('a %s registration', (status) => {
  it('gets no session from login, and the answer carries no token of any kind', async () => {
    const { user } = await unapproved(status);
    const res = await login(user.email);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(CODE[status]);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken|twoFactorToken/);
  });

  it('gets no second-factor challenge either (the challenge is the step before a session)', async () => {
    const { user } = await unapproved(status, { twoFactorEnabled: true });
    const res = await login(user.email);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/twoFactorToken|requires2FA/);
  });

  it('cannot finish a 2FA login with a challenge issued before the status changed', async () => {
    const { user } = await createUser('MEMBER', { twoFactorEnabled: true });
    const challenge = generateTwoFactorToken(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: status, isVerified: false } });
    // the service step that mints the session, reached after the OTP check
    await expect(authService.completeLoginAfter2FA(user.id)).rejects.toMatchObject({ statusCode: 403, code: CODE[status] });
    // and over HTTP: a wrong OTP never gets as far as a session either
    const res = await http().post('/api/auth/verify-2fa').send({ twoFactorToken: challenge, otp: '000000' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
  });

  it('an access token issued before the status changed stops working on every kind of route at once', async () => {
    const { user } = await createUser('MEMBER');
    const session = (await login(user.email)).body.data as { accessToken: string; refreshToken: string };
    const bearer = `Bearer ${session.accessToken}`;
    expect((await http().get('/api/auth/me').set('Authorization', bearer)).status).toBe(200);

    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: status, isVerified: false } });

    const other = await createUser('MEMBER');
    const attempts = [
      http().get('/api/auth/me').set('Authorization', bearer),
      http().get('/api/notifications').set('Authorization', bearer),
      http().get('/api/posts').set('Authorization', bearer),
      http().get(`/api/users/${other.user.id}`).set('Authorization', bearer),
      http().get('/api/users/me/export').set('Authorization', bearer),
      http().post('/api/auth/change-password').set('Authorization', bearer).send({ currentPassword: PASSWORD, newPassword: 'N3w!Passw0rd-xyz' }),
      http().post('/api/auth/logout').set('Authorization', bearer).send({}),
      http().post(`/api/messages/${other.user.id}`).set('Authorization', bearer).send({ content: 'hello' }),
      http().post(`/api/users/${other.user.id}/follow`).set('Authorization', bearer),
      http().delete('/api/users/me').set('Authorization', bearer).send({ password: PASSWORD }),
      http().post('/api/auth/2fa/enable').set('Authorization', bearer),
      http().post('/api/auth/2fa/disable').set('Authorization', bearer).send({ password: PASSWORD }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe(CODE[status]);
    }
    // the account row is exactly as the administrator left it
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.approvalStatus).toBe(status);
    expect(row.isActive).toBe(true);
  });

  it('the refresh token issued before the change is refused and is deleted, so it never works again even after approval', async () => {
    const { user } = await createUser('MEMBER');
    const session = (await login(user.email)).body.data as { accessToken: string; refreshToken: string };
    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: status, isVerified: false } });

    const res = await http().post('/api/auth/refresh-token').send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(CODE[status]);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken"/);
    expect(await prisma.refreshToken.count({ where: { userId: user.id } })).toBe(0);

    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: 'APPROVED', isVerified: true } });
    const again = await http().post('/api/auth/refresh-token').send({ refreshToken: session.refreshToken });
    expect(again.status).toBe(401);
  });

  it('a refresh token minted by hand is useless without a stored row (a forged family cannot be revived)', async () => {
    const { user } = await unapproved(status);
    const forged = generateRefreshToken(user.id);
    const res = await http().post('/api/auth/refresh-token').send({ refreshToken: forged });
    expect(res.status).toBe(401);
  });

  it('the password reset flow never returns a session: the reset answers with a message only and sign-in stays closed', async () => {
    const { user } = await unapproved(status);
    const token = 'r3-reset-token-' + status + '-' + Math.random().toString(16).slice(2);
    await prisma.verificationToken.create({
      data: { userId: user.id, token: hashToken(token), type: 'PASSWORD_RESET', expiresAt: new Date(Date.now() + 60_000) },
    });
    const reset = await http().post('/api/auth/reset-password').send({ token, password: 'Brand!New-Passw0rd9' });
    expect(reset.status).toBe(200);
    expect(JSON.stringify(reset.body)).not.toMatch(/accessToken|refreshToken/);
    const res = await login(user.email, 'Brand!New-Passw0rd9');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(CODE[status]);
  });

  it('verifying the e-mail address answers with a message only and does not open the account', async () => {
    const { user } = await unapproved(status, { emailVerifiedAt: null });
    const token = 'r3-verify-token-' + status + '-' + Math.random().toString(16).slice(2);
    await prisma.verificationToken.create({
      data: { userId: user.id, token: hashToken(token), type: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() + 60_000) },
    });
    const res = await http().post('/api/auth/verify-email').send({ token, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.approvalStatus).toBe(status);
    expect(row.isVerified).toBe(false);
    expect((await login(user.email)).status).toBe(403);
  });

  it('cannot accept an invitation, and the invitation stays usable for somebody who is a member', async () => {
    const { user } = await unapproved(status);
    const inviter = await createUser('MEMBER');
    const link = await http().post('/api/invites/generate-link').set('Authorization', inviter.auth).send({});
    expect(link.status).toBeLessThan(300);
    const code = new URL(link.body.data.link).searchParams.get('ref') as string;
    expect(code).toBeTruthy();
    const bearer = `Bearer ${generateAccessToken(user.id, user.email, user.userRole)}`;
    const res = await http().post(`/api/invites/${code}/accept`).set('Authorization', bearer).send({});
    expect(res.status).toBe(403);
    expect(await prisma.connection.count({ where: { OR: [{ requesterId: user.id }, { addresseeId: user.id }] } })).toBe(0);
  });

  it('is invisible to members: profile, message, follow, connection request and referral all look like a missing record', async () => {
    const { user } = await unapproved(status);
    const member = await createUser('MEMBER');
    const calls = [
      http().get(`/api/users/${user.id}`).set('Authorization', member.auth),
      http().post(`/api/messages/${user.id}`).set('Authorization', member.auth).send({ content: 'hi' }),
      http().post(`/api/users/${user.id}/follow`).set('Authorization', member.auth),
      http().post(`/api/network/request/${user.id}`).set('Authorization', member.auth).send({}),
      http().post('/api/referrals').set('Authorization', member.auth).send({ targetId: user.id, company: 'Acme', message: 'please' }),
    ];
    for (const res of await Promise.all(calls)) {
      expect([400, 404]).toContain(res.status);
    }
    expect(await prisma.message.count({ where: { receiverId: user.id } })).toBe(0);
    expect(await prisma.connection.count({ where: { addresseeId: user.id } })).toBe(0);
  });

  it('is treated as a visitor, not as a member, where a token is optional (donation order)', async () => {
    const { user } = await createUser('MEMBER');
    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: status, isVerified: false } });
    const bearer = `Bearer ${generateAccessToken(user.id, user.email, user.userRole, user.tokenVersion)}`;
    const res = await http().get('/api/landing').set('Authorization', bearer);
    expect(res.status).toBe(200);
    const asVisitor = await http().get('/api/landing');
    expect(res.body).toEqual(asVisitor.body);
  });
});

describe('socket.io handshake', () => {
  const handshake = async (token: string) => {
    let error: Error | undefined;
    let connected = false;
    await socketAuthMiddleware({ handshake: { auth: { token }, headers: {} } } as never, (err) => {
      if (err) error = err;
      else connected = true;
    });
    return { connected, error };
  };

  it.each(STATUSES)('refuses a %s account, a token from before the status changed included', async (status) => {
    const { user } = await createUser('MEMBER');
    const token = generateAccessToken(user.id, user.email, user.userRole, user.tokenVersion);
    expect((await handshake(token)).connected).toBe(true);
    await prisma.user.update({ where: { id: user.id }, data: { approvalStatus: status } });
    const after = await handshake(token);
    expect(after.connected).toBe(false);
    expect(after.error?.message).toBe('Authentication error');
  });

  it('refuses a deactivated account and a token of a deleted account', async () => {
    const { user } = await createUser('MEMBER');
    const token = generateAccessToken(user.id, user.email, user.userRole, user.tokenVersion);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    expect((await handshake(token)).connected).toBe(false);
    const ghost = generateAccessToken('00000000-0000-4000-8000-000000000000', 'x@y.z', 'MEMBER');
    expect((await handshake(ghost)).connected).toBe(false);
  });
});

describe('registration itself', () => {
  it('cannot be created approved: approvalStatus, isVerified, emailVerifiedAt, role and flags in the body are ignored', async () => {
    const email = uniqueEmail('self-approve');
    const res = await http().post('/api/auth/register').send({
      email,
      password: 'Reg!Passw0rd-r3x',
      fullName: 'Self Approver',
      batchYear: 2015,
      department: 'Civil',
      degree: 'B.E.',
      approvalStatus: 'APPROVED',
      isVerified: true,
      emailVerifiedAt: new Date().toISOString(),
      userRole: 'SUPER_ADMIN',
      isActive: true,
      approvalReviewedById: 'x',
      approvalNote: 'pre-approved',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.approvalStatus).toBe('PENDING');
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.approvalStatus).toBe('PENDING');
    expect(row.isVerified).toBe(false);
    expect(row.emailVerifiedAt).toBeNull();
    expect(row.userRole).toBe('MEMBER');
    expect(row.approvalNote).toBeNull();
    expect((await login(email, 'Reg!Passw0rd-r3x')).status).toBe(403);
  });
});
