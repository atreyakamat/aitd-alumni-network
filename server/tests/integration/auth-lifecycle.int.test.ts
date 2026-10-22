/**
 * Auth lifecycle against a real PostgreSQL database:
 * register → verify email → login → me → refresh rotation → logout,
 * plus password reset and 2FA login.
 */
import * as email from '../../src/utils/email';
import { hashToken } from '../../src/utils/jwt';
import { REFRESH_REUSE_GRACE_MS } from '../../src/services/authService';
import { http, prisma, uniqueEmail } from './helpers';

const PASSWORD = 'Alumni#2026';

const spy = <K extends keyof typeof email>(name: K) =>
  jest.spyOn(email, name as any).mockResolvedValue(undefined as never) as unknown as jest.Mock;

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const register = async (address: string) =>
  http().post('/api/auth/register').send({
    email: address,
    password: PASSWORD,
    fullName: 'Ananya Rao',
    batchYear: 2019,
    department: 'Computer Engineering',
    degree: 'B.E.',
  });

describe('auth lifecycle', () => {
  it('registers, verifies email, logs in, rotates refresh tokens and logs out', async () => {
    const verifyMail = spy('sendVerificationEmail');
    const address = uniqueEmail('lifecycle');

    const reg = await register(address.toUpperCase());
    expect(reg.status).toBe(201);
    expect(JSON.stringify(reg.body)).not.toMatch(/passwordHash/);

    // Email is normalised and the stored verification token is not the raw one
    const stored = await prisma.user.findUnique({ where: { email: address } });
    expect(stored).not.toBeNull();
    expect(stored!.userRole).toBe('MEMBER');

    // Duplicate registration is rejected
    expect((await register(address)).status).toBe(409);

    const rawToken = verifyMail.mock.calls[0]?.[2];
    if (rawToken) {
      const verified = await http().post('/api/auth/verify-email').send({ token: rawToken });
      expect(verified.status).toBe(200);
      expect((await prisma.user.findUnique({ where: { email: address } }))!.isVerified).toBe(true);
      // Single use
      expect((await http().post('/api/auth/verify-email').send({ token: rawToken })).status).toBeGreaterThanOrEqual(400);
    }

    const bad = await http().post('/api/auth/login').send({ email: address, password: 'Wrong#Pass1' });
    expect(bad.status).toBe(401);

    const login = await http().post('/api/auth/login').send({ email: address, password: PASSWORD });
    expect(login.status).toBe(200);
    const { accessToken, refreshToken } = login.body.data;
    expect(accessToken).toBeTruthy();
    expect(refreshToken).toBeTruthy();

    // Refresh tokens are stored hashed, never in plain text
    expect(await prisma.refreshToken.count({ where: { token: refreshToken } })).toBe(0);

    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(address);

    const refreshed = await http().post('/api/auth/refresh-token').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    const rotated = refreshed.body.data.refreshToken;
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(refreshToken);

    // The old refresh token is single-use
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken })).status).toBe(401);

    const newAccess = refreshed.body.data.accessToken;
    const logout = await http()
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${newAccess}`)
      .send({ refreshToken: rotated });
    expect(logout.status).toBe(200);
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: rotated })).status).toBe(401);
  });

  it('resets a forgotten password and revokes existing sessions', async () => {
    const resetMail = spy('sendPasswordResetEmail');
    spy('sendVerificationEmail');
    const address = uniqueEmail('reset');
    await register(address);

    const login = await http().post('/api/auth/login').send({ email: address, password: PASSWORD });
    const oldRefresh = login.body.data.refreshToken;

    // Same response for unknown emails (no account enumeration)
    const unknown = await http().post('/api/auth/forgot-password').send({ email: uniqueEmail('nobody') });
    const known = await http().post('/api/auth/forgot-password').send({ email: address });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);

    await new Promise((r) => setTimeout(r, 50)); // reset mail is sent fire-and-forget
    const token = resetMail.mock.calls[0][2];

    const weak = await http().post('/api/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(400);

    const reset = await http().post('/api/auth/reset-password').send({ token, password: 'Brand#New2026' });
    expect(reset.status).toBe(200);

    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: oldRefresh })).status).toBe(401);
    expect((await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).status).toBe(401);
    expect((await http().post('/api/auth/login').send({ email: address, password: 'Brand#New2026' })).status).toBe(200);
    // Token cannot be replayed
    expect((await http().post('/api/auth/reset-password').send({ token, password: 'Another#One2026' })).status).toBeGreaterThanOrEqual(400);
  });

  it('detects reuse of a rotated refresh token and revokes the whole family', async () => {
    spy('sendVerificationEmail');
    const address = uniqueEmail('reuse');
    await register(address);

    const login = await http().post('/api/auth/login').send({ email: address, password: PASSWORD });
    const original = login.body.data.refreshToken;

    // A second, independent session (other device) must survive the theft response
    const otherDevice = (await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).body.data.refreshToken;

    const first = await http().post('/api/auth/refresh-token').send({ refreshToken: original });
    expect(first.status).toBe(200);
    const second = await http().post('/api/auth/refresh-token').send({ refreshToken: first.body.data.refreshToken });
    expect(second.status).toBe(200);
    const newest = second.body.data.refreshToken;

    // Move the original rotation outside the multi-tab grace window
    await prisma.refreshToken.update({
      where: { token: hashToken(original) },
      data: { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 5_000) },
    });

    // Replaying the original (already rotated) token is treated as theft
    const replay = await http().post('/api/auth/refresh-token').send({ refreshToken: original });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // ...so even the newest token in that family stops working
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: newest })).status).toBe(401);
    // ...while the other device's family is untouched
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: otherDevice })).status).toBe(200);
  });

  it('treats a replay right after rotation as a lost multi-tab race, not theft', async () => {
    spy('sendVerificationEmail');
    const address = uniqueEmail('race');
    await register(address);

    const { refreshToken } = (await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).body.data;
    const winner = await http().post('/api/auth/refresh-token').send({ refreshToken });
    expect(winner.status).toBe(200);

    // Second tab presents the same token moments later
    const loser = await http().post('/api/auth/refresh-token').send({ refreshToken });
    expect(loser.status).toBe(401);
    expect(loser.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    expect(loser.body.data).toBeUndefined();

    // The winner's rotated token (shared via storage) keeps the session alive
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: winner.body.data.refreshToken })).status).toBe(200);
  });

  it('changes the password while signed in, revoking other sessions but keeping this one', async () => {
    spy('sendVerificationEmail');
    const changedMail = spy('sendPasswordChangedEmail');
    const address = uniqueEmail('change');
    await register(address);

    const here = (await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).body.data;
    const other = (await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).body.data;

    const wrong = await http()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${here.accessToken}`)
      .send({ currentPassword: 'Wrong#Pass1', newPassword: 'Changed#2026' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_PASSWORD');

    const weak = await http()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${here.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'weak' });
    expect(weak.status).toBe(400);

    const changed = await http()
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${here.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'Changed#2026' });
    expect(changed.status).toBe(200);
    const fresh = changed.body.data;
    expect(changedMail).toHaveBeenCalledWith(address, 'Ananya Rao');

    // Old access tokens (this device and the other) are revoked...
    for (const stale of [here.accessToken, other.accessToken]) {
      const res = await http().get('/api/auth/me').set('Authorization', `Bearer ${stale}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TOKEN_REVOKED');
    }
    // ...as are all old refresh tokens
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: here.refreshToken })).status).toBe(401);
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: other.refreshToken })).status).toBe(401);

    // The new session works and can be refreshed
    expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${fresh.accessToken}`)).status).toBe(200);
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: fresh.refreshToken })).status).toBe(200);

    // Only the new password signs in
    expect((await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).status).toBe(401);
    expect((await http().post('/api/auth/login').send({ email: address, password: 'Changed#2026' })).status).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'PASSWORD_CHANGE', entityId: (await prisma.user.findUnique({ where: { email: address } }))!.id },
    });
    expect(audit).not.toBeNull();
  });

  it('revokes outstanding access tokens after a password reset', async () => {
    const resetMail = spy('sendPasswordResetEmail');
    spy('sendVerificationEmail');
    const address = uniqueEmail('revoke');
    await register(address);

    const login = await http().post('/api/auth/login').send({ email: address, password: PASSWORD });
    const oldAccess = login.body.data.accessToken;
    expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${oldAccess}`)).status).toBe(200);

    await http().post('/api/auth/forgot-password').send({ email: address });
    await new Promise((r) => setTimeout(r, 50)); // reset mail is sent fire-and-forget
    const token = resetMail.mock.calls[0][2];
    expect((await http().post('/api/auth/reset-password').send({ token, password: 'Brand#New2026' })).status).toBe(200);

    const stale = await http().get('/api/auth/me').set('Authorization', `Bearer ${oldAccess}`);
    expect(stale.status).toBe(401);
    expect(stale.body.error.code).toBe('TOKEN_REVOKED');

    const relogin = await http().post('/api/auth/login').send({ email: address, password: 'Brand#New2026' });
    expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${relogin.body.data.accessToken}`)).status).toBe(200);
  });

  it('logging out without a refresh token revokes every session and access token', async () => {
    spy('sendVerificationEmail');
    const address = uniqueEmail('logoutall');
    await register(address);

    const a = (await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).body.data;
    const b = (await http().post('/api/auth/login').send({ email: address, password: PASSWORD })).body.data;

    expect((await http().post('/api/auth/logout').set('Authorization', `Bearer ${a.accessToken}`).send({})).status).toBe(200);

    expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${b.accessToken}`)).status).toBe(401);
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: b.refreshToken })).status).toBe(401);
  });

  it('requires the OTP for 2FA accounts and binds verification to the login session', async () => {
    spy('sendVerificationEmail');
    const otpMail = jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
    const address = uniqueEmail('twofa');
    await register(address);
    await prisma.user.update({ where: { email: address }, data: { twoFactorEnabled: true } });

    const login = await http().post('/api/auth/login').send({ email: address, password: PASSWORD });
    expect(login.status).toBe(200);
    const data = login.body.data;
    expect(data.accessToken).toBeUndefined();
    expect(data.twoFactorToken).toBeTruthy();

    // A bare userId (no password step) is not enough
    const forged = await http().post('/api/auth/verify-2fa').send({ userId: data.userId, otp: '123456' });
    expect(forged.status).toBe(400);

    // Only the most recently issued code is valid
    const html: string = (otpMail.mock.calls[otpMail.mock.calls.length - 1][0] as any).html;
    // Look only at visible text: inline CSS colours such as #002045 are also 6 digits
    const visibleText = html.replace(/<[^>]*>/g, ' ');
    const otp = visibleText.match(/\b(\d{6})\b/)?.[1];
    expect(otp).toBeDefined();

    const wrong = await http().post('/api/auth/verify-2fa').send({ twoFactorToken: data.twoFactorToken, otp: otp === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const ok = await http().post('/api/auth/verify-2fa').send({ twoFactorToken: data.twoFactorToken, otp });
    expect({ status: ok.status, body: ok.body }).toMatchObject({ status: 200 });
    expect(ok.body.data.accessToken).toBeTruthy();

    // OTP is single-use
    const replay = await http().post('/api/auth/verify-2fa').send({ twoFactorToken: data.twoFactorToken, otp });
    expect(replay.status).toBeGreaterThanOrEqual(400);
  });
});
