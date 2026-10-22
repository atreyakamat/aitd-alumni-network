/**
 * HTTP-level auth flows through the real app: routing, zod validation,
 * controllers, services and the error handler wired together.
 */
import jwt from 'jsonwebtoken';
import { api, authAs, getApp, prismaMock } from '../../../tests/helpers';
import { hashPassword } from '../../utils/password';
import { hashToken, verifyAccessToken } from '../../utils/jwt';
import { sendEmail } from '../../utils/email';
import { config } from '../../config';

const PASSWORD = 'Correct#Pass1';
let passwordHash: string;
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  // Building the full app is slow under coverage; keep it out of the first test's budget
  getApp();
}, 60_000);
beforeEach(() => jest.clearAllMocks());

const dbUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'alum@aitd.edu',
  fullName: 'Ada Alum',
  passwordHash,
  profilePhotoUrl: null,
  userRole: 'MEMBER',
  isActive: true,
  isVerified: true,
  twoFactorEnabled: false,
  profileCompleteness: 40,
  membershipTier: null,
  ...overrides,
});

describe('auth routes', () => {
  it('POST /auth/register rejects weak passwords with 400 VALIDATION_ERROR', async () => {
    const res = await api().post('/api/auth/register').send({
      email: 'new@aitd.edu',
      password: 'password',
      fullName: 'New Alum',
      batchYear: 2020,
      department: 'IT',
      degree: 'B.E.',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('POST /auth/login answers malformed JSON with 400 INVALID_JSON, not 500', async () => {
    const res = await api().post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('POST /auth/login never returns credentials material', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    const res = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.data.accessToken).userId).toBe('u1');
    expect(JSON.stringify(res.body)).not.toContain(passwordHash);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('POST /auth/login gives identical 401s for unknown email and wrong password', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(dbUser());
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@aitd.edu', password: PASSWORD });
    const wrong = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: 'Wrong#Pass1' });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('runs the full 2FA login: password -> challenge -> OTP -> session', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ twoFactorEnabled: true }));

    const login = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({ requires2FA: true, userId: 'u1', twoFactorToken: expect.any(String) });
    expect(login.body.data.accessToken).toBeUndefined();

    const otp = ((sendEmail as jest.Mock).mock.calls[0][0].html as string).match(/letter-spacing[^>]*>\s*(\d{6})\s*</)![1];
    const stored = prismaMock.verificationToken.create.mock.calls[0][0].data;

    // A bare userId (the old contract) no longer bypasses the password step
    const bypass = await api().post('/api/auth/verify-2fa').send({ userId: 'u1', otp });
    expect(bypass.status).toBe(400);
    expect(bypass.body.data).toBeUndefined();

    prismaMock.verificationToken.count.mockResolvedValue(0);
    prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'otp1', ...stored });
    prismaMock.verificationToken.updateMany.mockResolvedValue({ count: 1 });

    const verified = await api()
      .post('/api/auth/verify-2fa')
      .send({ twoFactorToken: login.body.data.twoFactorToken, otp });
    expect(verified.status).toBe(200);
    expect(verifyAccessToken(verified.body.data.accessToken).userId).toBe('u1');
  });

  it('POST /auth/verify-2fa reports a wrong code as 400 INVALID_OTP', async () => {
    const challenge = jwt.sign(
      { userId: 'u1', purpose: '2fa-challenge' },
      require('crypto').createHmac('sha256', config.jwt.secret).update('2fa-challenge').digest('hex')
    );
    prismaMock.verificationToken.count.mockResolvedValue(0);
    prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'otp1', token: 'x'.repeat(64) });
    const res = await api().post('/api/auth/verify-2fa').send({ twoFactorToken: challenge, otp: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_OTP');
  });

  it('POST /auth/resend-2fa refuses a bare userId', async () => {
    const res = await api().post('/api/auth/resend-2fa').send({ userId: 'u1' });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('POST /auth/refresh-token rotates the token', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    const login = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: PASSWORD });
    const { refreshToken } = login.body.data;

    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      token: hashToken(refreshToken),
      familyId: 'fam-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: dbUser(),
    });
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const res = await api().post('/api/auth/refresh-token').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
    expect(prismaMock.refreshToken.findUnique.mock.calls[0][0].where).toEqual({ token: hashToken(refreshToken) });
  });

  it('POST /auth/refresh-token answers a replayed token with 401 REFRESH_TOKEN_REUSED', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    const login = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: PASSWORD });
    const { refreshToken } = login.body.data;

    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      token: hashToken(refreshToken),
      familyId: 'fam-1',
      // Outside the multi-tab grace window, so this is a genuine replay
      revokedAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      user: dbUser(),
    });

    const res = await api().post('/api/auth/refresh-token').send({ refreshToken });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('GET /auth/me answers a revoked access token (tokenVersion bumped) with 401 TOKEN_REVOKED', async () => {
    const { user, header } = authAs('MEMBER');
    prismaMock.user.findUnique.mockResolvedValue({ ...user, tokenVersion: 1 });
    const res = await api().get('/api/auth/me').set('Authorization', header);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('GET /auth/me returns TOKEN_EXPIRED for an expired access token', async () => {
    const expired = jwt.sign({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 5 }, config.jwt.secret);
    const res = await api().get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('POST /auth/logout revokes only the caller\'s own token', async () => {
    const { header, user } = authAs('MEMBER');
    const res = await api().post('/api/auth/logout').set('Authorization', header).send({ refreshToken: 'rt-value' });
    expect(res.status).toBe(200);
    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({
      where: { token: hashToken('rt-value'), userId: user.id },
    });
  });

  describe('POST /auth/change-password', () => {
    const arrange = () => {
      const { user, header } = authAs('MEMBER');
      prismaMock.user.findUnique.mockResolvedValue({ ...dbUser({ id: user.id, email: user.email }), tokenVersion: 0 });
      prismaMock.user.update.mockResolvedValue({ tokenVersion: 1 });
      return { user, header };
    };

    it('requires authentication', async () => {
      const res = await api().post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'Brand#New2026' });
      expect(res.status).toBe(401);
    });

    it('applies the register/reset password-strength rules to newPassword', async () => {
      const { header } = arrange();
      for (const newPassword of ['short1A', 'alllowercase1', 'NoDigitsHere', 'A1' + 'a'.repeat(127)]) {
        const res = await api()
          .post('/api/auth/change-password')
          .set('Authorization', header)
          .send({ currentPassword: PASSWORD, newPassword });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      const missing = await api().post('/api/auth/change-password').set('Authorization', header).send({ newPassword: 'Brand#New2026' });
      expect(missing.status).toBe(400);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong current password with 401 INVALID_PASSWORD', async () => {
      const { header } = arrange();
      const res = await api()
        .post('/api/auth/change-password')
        .set('Authorization', header)
        .send({ currentPassword: 'Wrong#Pass1', newPassword: 'Brand#New2026' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_PASSWORD');
    });

    it('returns a fresh token pair carrying the bumped tokenVersion', async () => {
      const { header, user } = arrange();
      const res = await api()
        .post('/api/auth/change-password')
        .set('Authorization', header)
        .send({ currentPassword: PASSWORD, newPassword: 'Brand#New2026' });
      expect(res.status).toBe(200);
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
      expect(verifyAccessToken(res.body.data.accessToken)).toMatchObject({ userId: user.id, tv: 1 });
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|Brand#New2026/);
    });
  });

  it('POST /auth/forgot-password responds identically for unknown accounts', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(dbUser());
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost@aitd.edu' });
    const known = await api().post('/api/auth/forgot-password').send({ email: 'alum@aitd.edu' });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });
});
