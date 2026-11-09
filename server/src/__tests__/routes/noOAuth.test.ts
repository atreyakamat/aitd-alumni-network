/**
 * There is exactly one way to get an account: the registration form (the applicant submits a request and a college
 * administrator verifies and approves it). Google and LinkedIn sign-in were removed, so every route that belonged to
 * them must answer 404 through the real app, and the password sign-in / token refresh must keep working.
 *
 * Members who earlier signed up through Google or LinkedIn have no password. They continue through the normal
 * "Forgot password" e-mail, which is exercised end to end at the bottom of this file.
 */
import fs from 'fs';
import path from 'path';
import { api, getApp, prismaMock } from '../../../tests/helpers';
import { collectRoutes } from '../../../tests/docs/apiReference';
import router from '../../routes';
import { config } from '../../config';
import { hashPassword } from '../../utils/password';
import { hashToken, verifyAccessToken } from '../../utils/jwt';
import { sendPasswordResetEmail } from '../../utils/email';
import { TOKEN_TYPES } from '../../services/authService';
import * as socketUtil from '../../utils/socket';

const PASSWORD = 'Correct#Pass1';
const NEW_PASSWORD = 'Brand#New2026';
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
  approvalStatus: 'APPROVED',
  isVerified: true,
  emailVerifiedAt: new Date(),
  twoFactorEnabled: false,
  profileCompleteness: 40,
  membershipTier: null,
  tokenVersion: 0,
  ...overrides,
});

describe('Google and LinkedIn sign-in are gone', () => {
  const removed = [
    ['GET', '/api/auth/google'],
    ['GET', '/api/auth/google/callback'],
    ['GET', '/api/auth/linkedin'],
    ['GET', '/api/auth/linkedin/callback'],
    ['GET', '/api/auth/oauth/providers'],
    ['POST', '/api/auth/oauth/exchange'],
  ] as const;

  it.each(removed)('%s %s answers 404', async (method, url) => {
    const res =
      method === 'GET'
        ? await api().get(url)
        : await api().post(url).send({ code: 'a-one-time-code' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    // nothing is redirected, no OAuth state cookie is handed out, nothing is looked up or created
    expect(res.headers.location).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(prismaMock.verificationToken.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/auth/google/callback?code=abc&state=xyz'],
    ['/api/auth/linkedin/callback?code=abc&state=xyz'],
    ['/api/auth/google/'],
    ['/api/auth/LinkedIn'],
  ])('GET %s (with a code, a trailing slash or another spelling) answers 404', async (url) => {
    const res = await api().get(url);
    expect(res.status).toBe(404);
    expect(res.headers.location).toBeUndefined();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('no route of the API router mentions OAuth, Google or LinkedIn', () => {
    const paths = collectRoutes(router).map((r) => `${r.method} ${r.path}`);
    expect(paths.length).toBeGreaterThan(100);
    expect(paths.filter((p) => /oauth|google|linkedin/i.test(p))).toEqual([]);
  });

  it('the provider code and settings no longer exist', () => {
    const src = path.resolve(__dirname, '../..');
    expect(fs.existsSync(path.join(src, 'config/passport.ts'))).toBe(false);
    expect(fs.existsSync(path.join(src, 'middleware/oauthState.ts'))).toBe(false);
    expect(config).not.toHaveProperty('google');
    expect(config).not.toHaveProperty('linkedin');
  });
});

describe('password sign-in and token refresh still work', () => {
  it('POST /auth/login signs an approved member in', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser());

    const res = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(verifyAccessToken(res.body.data.accessToken).userId).toBe('u1');
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
  });

  it('POST /auth/refresh-token rotates the refresh token', async () => {
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
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('POST /auth/login still gates on the administrator approval', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'PENDING', isVerified: false }));

    const res = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(res.body.data).toBeUndefined();
  });

  it('POST /auth/register is still the way to get an account', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(dbUser({ isVerified: false, approvalStatus: 'PENDING' }));

    const res = await api().post('/api/auth/register').send({
      email: 'new@aitd.edu',
      password: PASSWORD,
      fullName: 'New Alum',
      batchYear: 2020,
      department: 'IT',
      degree: 'B.E.',
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ approvalStatus: 'PENDING' });
    expect(res.body.data.accessToken).toBeUndefined();
  });
});

describe('members created earlier through Google / LinkedIn (no password) continue with "Forgot password"', () => {
  it.each([
    ['an empty password hash', ''],
    ['a null password hash', null],
  ])('an account with %s gets a reset link, sets a password and signs in', async (_name, hash) => {
    const legacy = dbUser({ passwordHash: hash, isVerified: false });
    jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);

    // 1. password sign-in is not possible yet, and it answers like any unknown address
    prismaMock.user.findUnique.mockResolvedValue(legacy);
    const before = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: PASSWORD });
    expect(before.status).toBe(401);
    expect(before.body.error.code).toBe('INVALID_CREDENTIALS');

    // 2. "Forgot password": the answer is identical to the one for an unknown address...
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const unknown = await api().post('/api/auth/forgot-password').send({ email: 'ghost@aitd.edu' });
    prismaMock.user.findUnique.mockResolvedValue(legacy);
    const forgot = await api().post('/api/auth/forgot-password').send({ email: 'alum@aitd.edu' });
    expect(forgot.status).toBe(200);
    expect(forgot.body).toEqual(unknown.body);

    // ...but the link is really created and mailed
    const stored = prismaMock.verificationToken.create.mock.calls[0][0].data;
    expect(stored.type).toBe(TOKEN_TYPES.PASSWORD_RESET);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const rawToken = (sendPasswordResetEmail as jest.Mock).mock.calls[0][2];
    expect(stored.token).toBe(hashToken(rawToken));

    // 3. the link sets the password
    prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'vt1', userId: 'u1', user: legacy });
    prismaMock.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    const reset = await api().post('/api/auth/reset-password').send({ token: rawToken, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    const newHash = prismaMock.user.update.mock.calls[0][0].data.passwordHash;
    expect(newHash).toEqual(expect.any(String));
    expect(newHash).not.toBe(NEW_PASSWORD);

    // 4. and the normal password sign-in works from then on
    prismaMock.user.findUnique.mockResolvedValue({ ...legacy, passwordHash: newHash, tokenVersion: 1 });
    const after = await api().post('/api/auth/login').send({ email: 'alum@aitd.edu', password: NEW_PASSWORD });
    expect(after.status).toBe(200);
    expect(verifyAccessToken(after.body.data.accessToken).userId).toBe('u1');
  });
});
