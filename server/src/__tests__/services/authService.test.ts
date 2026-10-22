import { authService, REFRESH_REUSE_GRACE_MS, TOKEN_TYPES } from '../../services/authService';
import * as socketUtil from '../../utils/socket';
import { prismaMock } from '../../../tests/helpers';
import { comparePassword, hashPassword } from '../../utils/password';
import {
  generateAccessToken,
  generateRefreshToken,
  generateTwoFactorToken,
  hashToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyTwoFactorToken,
} from '../../utils/jwt';
import {
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWelcomeEmail,
} from '../../utils/email';

const PASSWORD = 'Correct#Pass1';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

// The harness resets prisma per test, but not the auto-mocked email module
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
  tokenVersion: 0,
  ...overrides,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

/** Arrange a one-time token lookup + successful atomic claim. */
const arrangeOneTimeToken = (user: Record<string, unknown> | null = dbUser(), claimCount = 1) => {
  prismaMock.verificationToken.findFirst.mockResolvedValue(user ? { id: 'vt1', userId: (user as any).id, user } : null);
  prismaMock.verificationToken.updateMany.mockResolvedValue({ count: claimCount });
};

describe('authService', () => {
  describe('register', () => {
    const input = {
      email: '  Alum@AITD.edu ',
      password: PASSWORD,
      fullName: ' Ada Alum ',
      batchYear: 2015,
      department: 'Computer Engineering',
      degree: 'B.E.',
    };

    it('creates a normalised user, stores a hashed EMAIL_VERIFY token and emails the raw token', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(dbUser({ isVerified: false }));

      const result = await authService.register(input);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alum@aitd.edu' } });
      const created = prismaMock.user.create.mock.calls[0][0].data;
      expect(created).toMatchObject({ email: 'alum@aitd.edu', fullName: 'Ada Alum', roleType: 'ALUMNI', batchYear: 2015 });
      expect(created.passwordHash).not.toBe(PASSWORD);
      await expect(comparePassword(PASSWORD, created.passwordHash)).resolves.toBe(true);

      const tokenData = prismaMock.verificationToken.create.mock.calls[0][0].data;
      expect(tokenData).toMatchObject({ userId: 'u1', type: TOKEN_TYPES.EMAIL_VERIFY });
      expect(tokenData.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
      // Verification tokens no longer live in the refresh-token table
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();

      const rawToken = (sendVerificationEmail as jest.Mock).mock.calls[0][2];
      expect(sendVerificationEmail).toHaveBeenCalledWith('alum@aitd.edu', 'Ada Alum', rawToken);
      expect(tokenData.token).toBe(hashToken(rawToken));
      expect(tokenData.token).not.toBe(rawToken);

      expect(result).toEqual({
        id: 'u1',
        email: 'alum@aitd.edu',
        fullName: 'Ada Alum',
        message: expect.stringContaining('Registration successful'),
      });
      expect(JSON.stringify(result)).not.toContain('passwordHash');
    });

    it('keeps an explicit roleType', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(dbUser());
      await authService.register({ ...input, roleType: 'STUDENT' });
      expect(prismaMock.user.create.mock.calls[0][0].data.roleType).toBe('STUDENT');
    });

    it('rejects a duplicate email with 409 EMAIL_EXISTS', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser());
      await expect(authService.register(input)).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_EXISTS' });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
    });

    it('still succeeds when the verification email fails to send', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(dbUser());
      (sendVerificationEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
      await expect(authService.register(input)).resolves.toMatchObject({ id: 'u1' });
    });
  });

  describe('login', () => {
    it('issues an access token and a DB-tracked hashed refresh token', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ membershipTier: { id: 't1', name: 'Gold' } }));

      const result: any = await authService.login({ email: ' ALUM@aitd.edu', password: PASSWORD });

      expect(prismaMock.user.findUnique.mock.calls[0][0].where).toEqual({ email: 'alum@aitd.edu' });
      expect(verifyAccessToken(result.accessToken)).toMatchObject({ userId: 'u1', userRole: 'MEMBER' });
      expect(verifyRefreshToken(result.refreshToken).userId).toBe('u1');

      const stored = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(stored.token).toBe(hashToken(result.refreshToken));
      expect(stored.token).not.toBe(result.refreshToken);
      expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 86400_000);
      // Every login starts a brand-new refresh-token family
      expect(stored.familyId).toMatch(UUID);

      expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { lastLoginAt: expect.any(Date) } });
      expect(result.user).toEqual({
        id: 'u1',
        email: 'alum@aitd.edu',
        fullName: 'Ada Alum',
        profilePhotoUrl: null,
        userRole: 'MEMBER',
        isVerified: true,
        membershipTier: { id: 't1', name: 'Gold' },
        profileCompleteness: 40,
        twoFactorEnabled: false,
      });
      expect(JSON.stringify(result)).not.toContain(passwordHash);
    });

    it("stamps the access token with the user's current tokenVersion", async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ tokenVersion: 7 }));
      const result: any = await authService.login({ email: 'alum@aitd.edu', password: PASSWORD });
      expect(verifyAccessToken(result.accessToken).tv).toBe(7);
    });

    it('starts a separate family for each login', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser());
      await authService.login({ email: 'alum@aitd.edu', password: PASSWORD });
      await authService.login({ email: 'alum@aitd.edu', password: PASSWORD });
      const [a, b] = prismaMock.refreshToken.create.mock.calls.map((c: any) => c[0].data.familyId);
      expect(a).not.toBe(b);
    });

    it("purges the user's expired refresh tokens on login", async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser());
      await authService.login({ email: 'alum@aitd.edu', password: PASSWORD });
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', expiresAt: { lt: expect.any(Date) } },
      });
    });

    it('rejects a wrong password with 401 INVALID_CREDENTIALS and issues nothing', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser());
      await expect(authService.login({ email: 'alum@aitd.edu', password: 'Wrong#Pass1' })).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('gives an unknown email the same error as a wrong password, after equal bcrypt work', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      const bcrypt = jest.requireActual('bcryptjs');
      const spy = jest.spyOn(bcrypt, 'compare');
      await expect(authService.login({ email: 'ghost@aitd.edu', password: PASSWORD })).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it('rejects password-less (OAuth-only) accounts as invalid credentials', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ passwordHash: '' }));
      await expect(authService.login({ email: 'alum@aitd.edu', password: '' })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    });

    it('blocks deactivated users (only after the password is proven)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));
      await expect(authService.login({ email: 'alum@aitd.edu', password: PASSWORD })).rejects.toMatchObject({
        statusCode: 401,
        code: 'ACCOUNT_DEACTIVATED',
      });
      await expect(authService.login({ email: 'alum@aitd.edu', password: 'Wrong#Pass1' })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('returns a 2FA challenge bound to the user and no session tokens when 2FA is enabled', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ twoFactorEnabled: true }));

      const result: any = await authService.login({ email: 'alum@aitd.edu', password: PASSWORD });

      expect(result.requires2FA).toBe(true);
      expect(result.accessToken).toBeUndefined();
      expect(result.refreshToken).toBeUndefined();
      expect(verifyTwoFactorToken(result.twoFactorToken)).toEqual({ userId: 'u1' });
      expect(result.user).toEqual({ id: 'u1', email: 'alum@aitd.edu', fullName: 'Ada Alum', twoFactorEnabled: true });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  describe('resolveTwoFactorChallenge', () => {
    it('returns the user id from a valid challenge', () => {
      expect(authService.resolveTwoFactorChallenge(generateTwoFactorToken('u1'))).toBe('u1');
    });

    it.each([
      ['garbage', 'not-a-jwt'],
      ['an access token', generateAccessToken('u1', 'a@b.io', 'MEMBER')],
      ['a refresh token', generateRefreshToken('u1')],
    ])('rejects %s with 401 INVALID_2FA_SESSION', (_label, token) => {
      expect(() => authService.resolveTwoFactorChallenge(token)).toThrow(
        expect.objectContaining({ statusCode: 401, code: 'INVALID_2FA_SESSION' })
      );
    });
  });

  describe('verifyEmail', () => {
    it('looks up the hashed token by type, claims it once, verifies the user and sends a welcome email', async () => {
      arrangeOneTimeToken();

      await expect(authService.verifyEmail('raw-token')).resolves.toEqual({ message: 'Email verified successfully' });

      const where = prismaMock.verificationToken.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({ token: hashToken('raw-token'), type: TOKEN_TYPES.EMAIL_VERIFY, isUsed: false });
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
      expect(prismaMock.verificationToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'vt1', isUsed: false },
        data: { isUsed: true },
      });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { isVerified: true, emailVerifiedAt: expect.any(Date) },
      });
      expect(sendWelcomeEmail).toHaveBeenCalledWith('alum@aitd.edu', 'Ada Alum');
    });

    it('rejects unknown/expired/wrong-type tokens with 400 INVALID_TOKEN', async () => {
      arrangeOneTimeToken(null);
      await expect(authService.verifyEmail('nope')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TOKEN' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('rejects a token that was redeemed concurrently', async () => {
      arrangeOneTimeToken(dbUser(), 0);
      await expect(authService.verifyEmail('raw')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('rejects an empty token without touching the database', async () => {
      await expect(authService.verifyEmail('')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
      expect(prismaMock.verificationToken.findFirst).not.toHaveBeenCalled();
    });

    it('cannot be satisfied by a refresh token (separate token stores)', async () => {
      await authService.verifyEmail(generateRefreshToken('u1')).catch(() => undefined);
      expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('tolerates a failing welcome email', async () => {
      arrangeOneTimeToken();
      (sendWelcomeEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp'));
      await expect(authService.verifyEmail('raw')).resolves.toBeDefined();
    });
  });

  describe('forgotPassword', () => {
    const GENERIC = { message: 'If the email exists, a password reset link has been sent.' };

    it('replaces older reset links with a hashed, 1-hour PASSWORD_RESET token and emails the raw token', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser());

      await expect(authService.forgotPassword(' Alum@AITD.edu ')).resolves.toEqual(GENERIC);

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alum@aitd.edu' } });
      expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: TOKEN_TYPES.PASSWORD_RESET },
      });
      const data = prismaMock.verificationToken.create.mock.calls[0][0].data;
      expect(data.type).toBe(TOKEN_TYPES.PASSWORD_RESET);
      expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 3600_000);
      const raw = (sendPasswordResetEmail as jest.Mock).mock.calls[0][2];
      expect(sendPasswordResetEmail).toHaveBeenCalledWith('alum@aitd.edu', 'Ada Alum', raw);
      expect(data.token).toBe(hashToken(raw));
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('returns the identical response for unknown emails without creating tokens (no enumeration)', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(authService.forgotPassword('ghost@aitd.edu')).resolves.toEqual(GENERIC);
      expect(prismaMock.verificationToken.create).not.toHaveBeenCalled();
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does not send reset links to deactivated accounts', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));
      await expect(authService.forgotPassword('alum@aitd.edu')).resolves.toEqual(GENERIC);
      expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('does not fail (or leak) when the email provider errors', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser());
      (sendPasswordResetEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp'));
      await expect(authService.forgotPassword('alum@aitd.edu')).resolves.toEqual(GENERIC);
      await new Promise((r) => setImmediate(r));
    });
  });

  describe('resetPassword', () => {
    it('sets a new bcrypt hash and revokes every session and outstanding reset link', async () => {
      arrangeOneTimeToken();
      const disconnect = jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);

      await expect(authService.resetPassword('raw', 'New#Password1')).resolves.toEqual({ message: 'Password reset successful' });

      expect(prismaMock.verificationToken.findFirst.mock.calls[0][0].where).toMatchObject({
        token: hashToken('raw'),
        type: TOKEN_TYPES.PASSWORD_RESET,
        isUsed: false,
      });
      const update = prismaMock.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'u1' });
      await expect(comparePassword('New#Password1', update.data.passwordHash)).resolves.toBe(true);
      // Outstanding access tokens die with the old password
      expect(update.data.tokenVersion).toEqual({ increment: 1 });
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: TOKEN_TYPES.PASSWORD_RESET },
      });
      expect(prismaMock.$transaction).toHaveBeenCalled();
      // Live sockets opened with the old tokens are closed too
      expect(disconnect).toHaveBeenCalledWith('u1');
    });

    it('rejects invalid, expired or already-used tokens with 400 INVALID_TOKEN', async () => {
      arrangeOneTimeToken(null);
      await expect(authService.resetPassword('raw', 'New#Password1')).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_TOKEN',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('cannot be used with a stolen refresh token', async () => {
      // Regression: reset tokens used to share the refresh-token table, so any valid
      // refresh token could reset the account password.
      prismaMock.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', userId: 'u1', expiresAt: future() });
      arrangeOneTimeToken(null);
      await expect(authService.resetPassword(generateRefreshToken('u1'), 'New#Password1')).rejects.toMatchObject({
        code: 'INVALID_TOKEN',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    const NEW = 'Brand#New2026';
    const arrangeUser = (overrides: Record<string, unknown> = {}) => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ tokenVersion: 4, ...overrides }));
      prismaMock.user.update.mockResolvedValue({ tokenVersion: 5 });
    };

    it('re-hashes, bumps tokenVersion, revokes every session atomically and issues a fresh session', async () => {
      arrangeUser();
      const disconnect = jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);

      const result = await authService.changePassword('u1', PASSWORD, NEW, { ipAddress: '1.2.3.4', userAgent: 'jest' });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      const update = prismaMock.user.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 'u1' });
      expect(update.data.tokenVersion).toEqual({ increment: 1 });
      await expect(comparePassword(NEW, update.data.passwordHash)).resolves.toBe(true);
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      // Outstanding reset links die with the old password too
      expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: TOKEN_TYPES.PASSWORD_RESET },
      });

      // The caller stays signed in with tokens carrying the NEW tokenVersion
      expect(verifyAccessToken(result.accessToken)).toMatchObject({ userId: 'u1', tv: 5 });
      expect(verifyRefreshToken(result.refreshToken).userId).toBe('u1');
      const created = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(created).toMatchObject({ userId: 'u1', token: hashToken(result.refreshToken) });
      expect(created.familyId).toMatch(UUID);
      // ...created after the wipe so it survives it
      expect(prismaMock.refreshToken.create.mock.invocationCallOrder[0]).toBeGreaterThan(
        prismaMock.refreshToken.deleteMany.mock.invocationCallOrder[0]
      );

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          action: 'PASSWORD_CHANGE',
          entityType: 'USER',
          entityId: 'u1',
          ipAddress: '1.2.3.4',
          userAgent: 'jest',
        }),
      });
      expect(JSON.stringify(prismaMock.auditLog.create.mock.calls[0][0])).not.toContain(NEW);
      expect(sendPasswordChangedEmail).toHaveBeenCalledWith('alum@aitd.edu', 'Ada Alum');
      expect(disconnect).toHaveBeenCalledWith('u1');
    });

    it('rejects a wrong current password with 401 INVALID_PASSWORD and changes nothing', async () => {
      arrangeUser();
      await expect(authService.changePassword('u1', 'Wrong#Pass1', NEW)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_PASSWORD',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.deleteMany).not.toHaveBeenCalled();
      expect(sendPasswordChangedEmail).not.toHaveBeenCalled();
    });

    it('rejects reusing the current password with 400 PASSWORD_UNCHANGED', async () => {
      arrangeUser();
      await expect(authService.changePassword('u1', PASSWORD, PASSWORD)).rejects.toMatchObject({
        statusCode: 400,
        code: 'PASSWORD_UNCHANGED',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('tells OAuth-only accounts (no password) to use password reset', async () => {
      arrangeUser({ passwordHash: null });
      const error = await authService.changePassword('u1', 'anything', NEW).catch((e) => e);
      expect(error).toMatchObject({ statusCode: 400, code: 'PASSWORD_NOT_SET' });
      expect(error.message).toMatch(/reset/i);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('404s for a missing user and 401s for a deactivated one', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(authService.changePassword('u1', PASSWORD, NEW)).rejects.toMatchObject({ statusCode: 404 });
      arrangeUser({ isActive: false });
      await expect(authService.changePassword('u1', PASSWORD, NEW)).rejects.toMatchObject({
        statusCode: 401,
        code: 'ACCOUNT_DEACTIVATED',
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('still succeeds when the notification email fails', async () => {
      arrangeUser();
      (sendPasswordChangedEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
      await expect(authService.changePassword('u1', PASSWORD, NEW)).resolves.toHaveProperty('accessToken');
      await new Promise((r) => setImmediate(r));
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('refreshToken', () => {
    const arrangeStored =(token: string, overrides: Record<string, unknown> = {}) =>
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'rt1',
        userId: 'u1',
        token: hashToken(token),
        familyId: 'fam-1',
        revokedAt: null,
        expiresAt: future(),
        user: dbUser(),
        ...overrides,
      });

    it('rotates: atomically revokes the presented token and issues a new one in the same family', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { user: dbUser({ tokenVersion: 2 }) });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await authService.refreshToken(presented);

      expect(prismaMock.refreshToken.findUnique.mock.calls[0][0].where).toEqual({ token: hashToken(presented) });
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt1', revokedAt: null },
        data: { revokedAt: expect.any(Date), familyId: 'fam-1' },
      });
      // The old row is kept (revoked) so a replay can be detected
      expect(prismaMock.refreshToken.deleteMany).not.toHaveBeenCalled();
      expect(result.refreshToken).not.toBe(presented);
      expect(verifyRefreshToken(result.refreshToken).userId).toBe('u1');
      expect(verifyAccessToken(result.accessToken)).toMatchObject({ userId: 'u1', tv: 2 });
      expect(prismaMock.refreshToken.create.mock.calls[0][0].data).toMatchObject({
        userId: 'u1',
        token: hashToken(result.refreshToken),
        familyId: 'fam-1',
      });
    });

    it('adopts a legacy token (no family) into a fresh family on rotation', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { familyId: null });
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await authService.refreshToken(presented);

      const claim = prismaMock.refreshToken.updateMany.mock.calls[0][0];
      const created = prismaMock.refreshToken.create.mock.calls[0][0].data;
      expect(created.familyId).toMatch(UUID);
      expect(claim.data.familyId).toBe(created.familyId);
    });

    it('treats a replayed (already revoked) token as theft: revokes the whole family with REFRESH_TOKEN_REUSED', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { revokedAt: past() });

      await expect(authService.refreshToken(presented)).rejects.toMatchObject({
        statusCode: 401,
        code: 'REFRESH_TOKEN_REUSED',
      });

      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', familyId: 'fam-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalled();
      expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          action: 'SECURITY_ALERT',
          entityType: 'USER',
          entityId: 'u1',
          newValues: expect.objectContaining({ reason: 'REFRESH_TOKEN_REUSED', familyId: 'fam-1' }),
        }),
      });
    });

    it('treats a replay within the grace window as a lost race (another tab rotated it): 401 INVALID_REFRESH_TOKEN, family kept', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { revokedAt: new Date(Date.now() - 2_000) });

      await expect(authService.refreshToken(presented)).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });

      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
      expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    });

    it('uses a short grace window and treats replays just outside it as reuse', async () => {
      expect(REFRESH_REUSE_GRACE_MS).toBeGreaterThan(0);
      expect(REFRESH_REUSE_GRACE_MS).toBeLessThanOrEqual(30_000);

      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { revokedAt: new Date(Date.now() - REFRESH_REUSE_GRACE_MS - 1_000) });
      await expect(authService.refreshToken(presented)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalled();
    });

    it('revokes every session of the user when a revoked token has no family', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { revokedAt: past(), familyId: null });
      await expect(authService.refreshToken(presented)).rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('rejects a token with a bad signature without hitting the DB', async () => {
      await expect(authService.refreshToken('forged.jwt.value')).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an access token presented as a refresh token', async () => {
      await expect(authService.refreshToken(generateAccessToken('u1', 'a@b.io', 'MEMBER'))).rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
      });
    });

    it('rejects a validly-signed token that is not in the DB (logged out / purged)', async () => {
      prismaMock.refreshToken.findUnique.mockResolvedValue(null);
      await expect(authService.refreshToken(generateRefreshToken('u1'))).rejects.toMatchObject({
        statusCode: 401,
        code: 'INVALID_REFRESH_TOKEN',
      });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects a stored token whose owner does not match the JWT subject', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { userId: 'someone-else' });
      await expect(authService.refreshToken(presented)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
      expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('rejects and purges a DB-expired token', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { expiresAt: past() });
      await expect(authService.refreshToken(presented)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { id: 'rt1' } });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects deactivated users with ACCOUNT_DEACTIVATED and revokes all their sessions', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented, { user: dbUser({ isActive: false }) });
      await expect(authService.refreshToken(presented)).rejects.toMatchObject({
        statusCode: 401,
        code: 'ACCOUNT_DEACTIVATED',
      });
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('lets only one of two concurrent refreshes with the same token win', async () => {
      const presented = generateRefreshToken('u1');
      arrangeStored(presented);
      prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(authService.refreshToken(presented)).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('does not mask unexpected DB failures as auth errors', async () => {
      prismaMock.refreshToken.findUnique.mockRejectedValue(new Error('db down'));
      await expect(authService.refreshToken(generateRefreshToken('u1'))).rejects.toThrow('db down');
    });
  });

  describe('logout', () => {
    it("revokes the presented token's whole family, scoped to the caller", async () => {
      const disconnect = jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);
      disconnect.mockClear();
      prismaMock.refreshToken.findUnique.mockResolvedValue({ id: 'rt1', userId: 'u1', familyId: 'fam-1' });
      await expect(authService.logout('u1', 'refresh-value')).resolves.toEqual({ message: 'Logged out successfully' });
      expect(prismaMock.refreshToken.findUnique).toHaveBeenCalledWith({ where: { token: hashToken('refresh-value') } });
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', familyId: 'fam-1' } });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      // Other devices keep their sessions, so their sockets stay up
      expect(disconnect).not.toHaveBeenCalled();
    });

    it("falls back to revoking only the presented token (legacy / unknown / someone else's)", async () => {
      const records = [null, { id: 'rt1', userId: 'u1', familyId: null }, { id: 'rt2', userId: 'other', familyId: 'fam-x' }];
      for (const record of records) {
        prismaMock.refreshToken.deleteMany.mockClear();
        prismaMock.refreshToken.findUnique.mockResolvedValue(record);
        await authService.logout('u1', 'refresh-value');
        expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledTimes(1);
        expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({
          where: { token: hashToken('refresh-value'), userId: 'u1' },
        });
      }
    });

    it('logs out everywhere when no token is given: revokes every session and bumps tokenVersion', async () => {
      const disconnect = jest.spyOn(socketUtil, 'disconnectUser').mockImplementation(() => undefined);
      await authService.logout('u1');
      expect(disconnect).toHaveBeenCalledWith('u1');
      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });
  });

  describe('getProfile', () => {
    it('returns the profile without the password hash', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...dbUser(), workExperiences: [] });
      const profile: any = await authService.getProfile('u1');
      expect(profile.passwordHash).toBeUndefined();
      expect(profile).toMatchObject({ id: 'u1', email: 'alum@aitd.edu', workExperiences: [] });
    });

    it('404s for a missing user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(authService.getProfile('nope')).rejects.toMatchObject({ statusCode: 404, code: 'USER_NOT_FOUND' });
    });
  });

  describe('completeLoginAfter2FA', () => {
    it('issues a session for an active user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ twoFactorEnabled: true }));
      const result = await authService.completeLoginAfter2FA('u1');
      expect(verifyAccessToken(result.accessToken).userId).toBe('u1');
      expect(prismaMock.refreshToken.create.mock.calls[0][0].data.token).toBe(hashToken(result.refreshToken));
      expect(result.user.twoFactorEnabled).toBe(true);
      expect((result.user as any).passwordHash).toBeUndefined();
    });

    it('404s for a missing user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(authService.completeLoginAfter2FA('x')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects a user deactivated mid-login', async () => {
      prismaMock.user.findUnique.mockResolvedValue(dbUser({ isActive: false }));
      await expect(authService.completeLoginAfter2FA('u1')).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('OAuth exchange codes', () => {
    it('creates a 5-minute hashed OAUTH_EXCHANGE code and returns the raw value', async () => {
      const code = await authService.createOAuthExchangeCode('u1');
      const data = prismaMock.verificationToken.create.mock.calls[0][0].data;
      expect(code).toMatch(/^[a-f0-9]{64}$/);
      expect(data).toMatchObject({ userId: 'u1', type: TOKEN_TYPES.OAUTH_EXCHANGE, token: hashToken(code) });
      expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    });

    it('exchanges a valid code exactly once for a session', async () => {
      arrangeOneTimeToken(dbUser());
      const result = await authService.exchangeOAuthCode('code');
      expect(prismaMock.verificationToken.findFirst.mock.calls[0][0].where).toMatchObject({
        token: hashToken('code'),
        type: TOKEN_TYPES.OAUTH_EXCHANGE,
        isUsed: false,
      });
      expect(prismaMock.verificationToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'vt1', isUsed: false },
        data: { isUsed: true },
      });
      expect(verifyAccessToken(result.accessToken).userId).toBe('u1');
    });

    it('rejects a replayed / concurrently redeemed code', async () => {
      arrangeOneTimeToken(dbUser(), 0);
      await expect(authService.exchangeOAuthCode('code')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CODE' });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects unknown or expired codes', async () => {
      arrangeOneTimeToken(null);
      await expect(authService.exchangeOAuthCode('code')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CODE' });
    });

    it('rejects deactivated users', async () => {
      arrangeOneTimeToken(dbUser({ isActive: false }));
      await expect(authService.exchangeOAuthCode('code')).rejects.toMatchObject({ statusCode: 401, code: 'ACCOUNT_DEACTIVATED' });
      expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    });
  });
});
