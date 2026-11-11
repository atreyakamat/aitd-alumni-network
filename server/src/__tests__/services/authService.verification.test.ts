/**
 * E-mail verification policy (REQUIRE_EMAIL_VERIFICATION, on by default in production).
 *
 * Threat: "account pre-hijacking". Anyone can register an address they do not own, with a password they know.
 * If that account can be used before the mailbox owner proves ownership, or if the owner can be tricked into
 * verifying it with an unsolicited link, the attacker keeps a working login into "the owner's" account.
 *
 * Controls under test:
 *  - no session before the address is verified (login answers 403 EMAIL_NOT_VERIFIED, after the password is proven)
 *  - the verification link only works together with the password chosen at registration, so a link mailed to the
 *    real owner for somebody else's registration cannot be completed by the owner
 *  - registering an address whose account is still unverified replaces that pending registration (the real owner
 *    is never locked out of their own address)
 *  - a rate-limited, enumeration-free "resend verification" that does not become a mail-bombing tool
 */
import { authService, TOKEN_TYPES } from '../../services/authService';
import { config } from '../../config';
import { prismaMock } from '../../../tests/helpers';
import { hashPassword } from '../../utils/password';
import { hashToken } from '../../utils/jwt';
import { sendVerificationEmail } from '../../utils/email';
import { publishNotificationEvent } from '../../services/notificationBus';

jest.mock('../../services/notificationBus', () => ({ publishNotificationEvent: jest.fn().mockResolvedValue(undefined) }));

const PASSWORD = 'Correct#Pass1';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => jest.clearAllMocks());

afterEach(() => {
  config.auth.requireEmailVerification = false;
});

const dbUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'alum@aiem.edu',
  fullName: 'Ada Alum',
  passwordHash,
  profilePhotoUrl: null,
  userRole: 'MEMBER',
  isActive: true,
  approvalStatus: 'APPROVED',
  isVerified: false,
  emailVerifiedAt: null,
  lastLoginAt: null,
  twoFactorEnabled: false,
  profileCompleteness: 40,
  membershipTier: null,
  tokenVersion: 0,
  ...overrides,
});

const arrangeOneTimeToken = (user: Record<string, unknown> | null = dbUser(), claimCount = 1) => {
  prismaMock.verificationToken.findFirst.mockResolvedValue(user ? { id: 'vt1', userId: (user as any).id, user } : null);
  prismaMock.verificationToken.updateMany.mockResolvedValue({ count: claimCount });
};

describe('login while the e-mail address is unverified', () => {
  const credentials = { email: 'alum@aiem.edu', password: PASSWORD };

  it('refuses a session with 403 EMAIL_NOT_VERIFIED once the password is proven (policy on)', async () => {
    config.auth.requireEmailVerification = true;
    prismaMock.user.findUnique.mockResolvedValue(dbUser());

    await expect(authService.login(credentials)).rejects.toMatchObject({ statusCode: 403, code: 'EMAIL_NOT_VERIFIED' });

    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('does not reveal the verification state to somebody who does not know the password', async () => {
    config.auth.requireEmailVerification = true;
    prismaMock.user.findUnique.mockResolvedValue(dbUser());

    await expect(authService.login({ ...credentials, password: 'Wrong#Pass1' })).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('lets verified accounts in, including accounts that only have emailVerifiedAt (the mailbox link was used)', async () => {
    config.auth.requireEmailVerification = true;
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ isVerified: true }));
    await expect(authService.login(credentials)).resolves.toHaveProperty('accessToken');

    prismaMock.user.findUnique.mockResolvedValue(dbUser({ isVerified: false, emailVerifiedAt: new Date() }));
    await expect(authService.login(credentials)).resolves.toHaveProperty('accessToken');
  });

  it('does not gate anything while the policy is off (local development)', async () => {
    config.auth.requireEmailVerification = false;
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    await expect(authService.login(credentials)).resolves.toHaveProperty('accessToken');
  });

  it('gates before the second factor: an unverified account never receives an OTP challenge', async () => {
    config.auth.requireEmailVerification = true;
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ twoFactorEnabled: true }));
    await expect(authService.login(credentials)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });
});

describe('verifyEmail with the registration password (policy on)', () => {
  beforeEach(() => {
    config.auth.requireEmailVerification = true;
  });

  it('verifies when the token and the registration password both match', async () => {
    arrangeOneTimeToken(dbUser({ approvalStatus: 'PENDING' }));

    await expect(authService.verifyEmail('raw-token', PASSWORD)).resolves.toEqual({ message: expect.stringMatching(/administrator/i) });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(publishNotificationEvent).toHaveBeenCalledWith('registration.received', { userId: 'u1' });
  });

  it('refuses a link opened without a password and leaves the token unspent', async () => {
    arrangeOneTimeToken();

    await expect(authService.verifyEmail('raw-token')).rejects.toMatchObject({ statusCode: 400, code: 'PASSWORD_REQUIRED' });

    expect(prismaMock.verificationToken.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("refuses somebody else's registration: the mailbox owner does not know the attacker's password", async () => {
    arrangeOneTimeToken();

    await expect(authService.verifyEmail('raw-token', 'Victim#Guess9')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VERIFY_PASSWORD_INVALID',
    });

    // neither the token nor the account is touched, so the account stays unusable
    expect(prismaMock.verificationToken.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('counts wrong passwords against the per-account budget (no offline-style guessing through the link)', async () => {
    arrangeOneTimeToken();
    prismaMock.verificationToken.create.mockResolvedValue({ id: 'reservation' } as any);
    prismaMock.verificationToken.delete.mockResolvedValue({} as any);
    prismaMock.verificationToken.count.mockResolvedValue(6);

    await expect(authService.verifyEmail('raw-token', 'Another#Guess9')).rejects.toMatchObject({
      statusCode: 429,
      code: 'PASSWORD_ATTEMPTS_EXCEEDED',
    });
    expect(prismaMock.verificationToken.updateMany).not.toHaveBeenCalled();
  });

  it('still answers 400 INVALID_TOKEN for an unknown or expired token, before any password work', async () => {
    arrangeOneTimeToken(null);
    await expect(authService.verifyEmail('nope', PASSWORD)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_TOKEN' });
  });

  it('is not required while the policy is off', async () => {
    config.auth.requireEmailVerification = false;
    arrangeOneTimeToken();
    await expect(authService.verifyEmail('raw-token')).resolves.toEqual({ message: 'Email verified successfully' });
  });
});

describe('registration does not wait for the mail server', () => {
  const input = { email: 'new@aiem.edu', password: PASSWORD, fullName: 'New Member', batchYear: 2020, department: 'Civil', degree: 'B.E.' };
  const neverFinishes = () => new Promise<void>(() => undefined);

  it('a new sign-up returns at once even if the mail server hangs (the member can use "resend")', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(dbUser({ id: 'new1', email: 'new@aiem.edu' }));
    (sendVerificationEmail as jest.Mock).mockImplementationOnce(neverFinishes);

    await expect(authService.register(input)).resolves.toMatchObject({ id: 'new1' });
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('the replaced pending registration returns at once too', async () => {
    config.auth.requireEmailVerification = true;
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    prismaMock.user.update.mockResolvedValue(dbUser());
    (sendVerificationEmail as jest.Mock).mockImplementationOnce(neverFinishes);

    await expect(authService.register({ ...input, email: 'alum@aiem.edu' })).resolves.toMatchObject({ id: 'u1' });
  });

  it('a failing mail server does not fail the sign-up or leave an unhandled rejection', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(dbUser({ id: 'new2', email: 'new@aiem.edu' }));
    (sendVerificationEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));

    await expect(authService.register(input)).resolves.toMatchObject({ id: 'new2' });
    await new Promise((resolve) => setImmediate(resolve)); // the rejection is caught and logged, not thrown
  });
});

describe('register over an address whose account is still unverified (policy on)', () => {
  const input = {
    email: 'Alum@AIEM.edu',
    password: PASSWORD,
    fullName: 'Real Owner',
    batchYear: 2015,
    department: 'Computer Engineering',
    degree: 'B.E.',
  };

  beforeEach(() => {
    config.auth.requireEmailVerification = true;
  });

  it('replaces the pending registration: new credentials, old sessions and old links are gone, a fresh link is mailed', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ fullName: 'Attacker Name' }));
    prismaMock.user.update.mockResolvedValue(dbUser({ fullName: 'Real Owner' }));

    const result = await authService.register(input);

    expect(prismaMock.user.create).not.toHaveBeenCalled();
    const update = prismaMock.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: 'u1' });
    expect(update.data).toMatchObject({ fullName: 'Real Owner', batchYear: 2015, tokenVersion: { increment: 1 } });
    expect(update.data.passwordHash).not.toBe(PASSWORD);
    expect(update.data.passwordHash).not.toBe(passwordHash);

    expect(prismaMock.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: TOKEN_TYPES.EMAIL_VERIFY },
    });
    const tokenData = prismaMock.verificationToken.create.mock.calls[0][0].data;
    expect(tokenData).toMatchObject({ userId: 'u1', type: TOKEN_TYPES.EMAIL_VERIFY });
    const rawToken = (sendVerificationEmail as jest.Mock).mock.calls[0][2];
    expect(tokenData.token).toBe(hashToken(rawToken));

    expect(result).toMatchObject({ id: 'u1', approvalStatus: 'PENDING', message: expect.stringContaining('Registration received') });
  });

  it.each([
    ['a verified account', { isVerified: true }],
    ['an account without a password (created earlier through a former provider sign-in)', { emailVerifiedAt: new Date(), passwordHash: null }],
    ['a deactivated account', { isActive: false }],
    ['an unverified account that has been signed in to (it predates the policy: a real member, not a pending sign-up)', { lastLoginAt: new Date() }],
  ])('never touches %s: 409 EMAIL_EXISTS', async (_label, overrides) => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser(overrides));

    await expect(authService.register(input)).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_EXISTS' });

    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('keeps the old 409 while the policy is off (an unverified account may already be in use)', async () => {
    config.auth.requireEmailVerification = false;
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    await expect(authService.register(input)).rejects.toMatchObject({ statusCode: 409, code: 'EMAIL_EXISTS' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('resendVerification', () => {
  const GENERIC = { message: 'If that address has an unverified account, a new verification link has been sent.' };

  it('mails a fresh link to an unverified, active account and invalidates the older ones', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    prismaMock.verificationToken.findFirst.mockResolvedValue(null);

    await expect(authService.resendVerification(' Alum@AIEM.edu ')).resolves.toEqual(GENERIC);

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'alum@aiem.edu' } });
    expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: TOKEN_TYPES.EMAIL_VERIFY },
    });
    const tokenData = prismaMock.verificationToken.create.mock.calls[0][0].data;
    expect(tokenData).toMatchObject({ userId: 'u1', type: TOKEN_TYPES.EMAIL_VERIFY });
    await new Promise((resolve) => setImmediate(resolve));
    const rawToken = (sendVerificationEmail as jest.Mock).mock.calls[0][2];
    expect(tokenData.token).toBe(hashToken(rawToken));
  });

  it.each([
    ['an unknown address', null],
    ['a verified account', dbUser({ isVerified: true })],
    ['an account whose mailbox link was already used', dbUser({ emailVerifiedAt: new Date() })],
    ['a deactivated account', dbUser({ isActive: false })],
    ['an account without a password', dbUser({ passwordHash: null })],
  ])('answers identically and sends nothing for %s (no enumeration)', async (_label, user) => {
    prismaMock.user.findUnique.mockResolvedValue(user as any);

    await expect(authService.resendVerification('alum@aiem.edu')).resolves.toEqual(GENERIC);

    expect(prismaMock.verificationToken.create).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends at most one link a minute per account (no mail-bombing a victim through this endpoint)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'recent', createdAt: new Date(Date.now() - 10_000) } as any);

    await expect(authService.resendVerification('alum@aiem.edu')).resolves.toEqual(GENERIC);

    expect(prismaMock.verificationToken.create).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    const where = prismaMock.verificationToken.findFirst.mock.calls[0][0]!.where as any;
    expect(where).toMatchObject({ userId: 'u1', type: TOKEN_TYPES.EMAIL_VERIFY });
    expect(where.createdAt.gt).toBeInstanceOf(Date);
  });

  it('does not fail (or leak) when the mail provider errors', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser());
    prismaMock.verificationToken.findFirst.mockResolvedValue(null);
    (sendVerificationEmail as jest.Mock).mockRejectedValueOnce(new Error('smtp down'));
    await expect(authService.resendVerification('alum@aiem.edu')).resolves.toEqual(GENERIC);
    await new Promise((resolve) => setImmediate(resolve));
  });
});
