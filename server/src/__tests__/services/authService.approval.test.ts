/**
 * Alumni approval. A registration is only a claim ("I am an alumnus of the college"). Until an administrator has
 * checked it, the person gets no session by any route: not by password, not after the second factor, not by refreshing
 * a token. (The registration form is the only way to get an account.)
 */
import { authService, TOKEN_TYPES } from '../../services/authService';
import { config } from '../../config';
import { prismaMock } from '../../../tests/helpers';
import { hashPassword } from '../../utils/password';
import { hashToken, generateRefreshToken } from '../../utils/jwt';
import { sendVerificationEmail, sendWelcomeEmail } from '../../utils/email';
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
  isVerified: false,
  emailVerifiedAt: new Date(),
  approvalStatus: 'PENDING',
  lastLoginAt: null,
  twoFactorEnabled: false,
  profileCompleteness: 40,
  membershipTier: null,
  tokenVersion: 0,
  ...overrides,
});

const credentials = { email: 'alum@aiem.edu', password: PASSWORD };

describe('registration', () => {
  const input = {
    email: 'New@AIEM.edu',
    password: PASSWORD,
    fullName: '  Ada Alum ',
    batchYear: 2015,
    department: 'Computer Engineering',
    degree: 'B.E.',
    enrollmentNumber: ' 12CE045 ',
    verificationNote: ' Class of 2015, ask Prof. Rao ',
  };

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockImplementation(async ({ data }: any) => ({ id: 'u9', ...data }));
    prismaMock.verificationToken.create.mockResolvedValue({});
  });

  it('keeps what the applicant tells the reviewer, trimmed', async () => {
    await authService.register(input as any);
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(data.enrollmentNumber).toBe('12CE045');
    expect(data.verificationNote).toBe('Class of 2015, ask Prof. Rao');
  });

  it('never creates an account that is already approved (the database default is PENDING)', async () => {
    await authService.register(input as any);
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('approvalStatus');
    expect(data).not.toHaveProperty('isVerified');
    expect(data).not.toHaveProperty('userRole');
  });

  it('says that an administrator has to approve it, and returns no session', async () => {
    const result: any = await authService.register(input as any);
    expect(result.message).toMatch(/administrator/i);
    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(result.approvalStatus).toBe('PENDING');
  });

  it('stores nothing for fields the applicant left empty', async () => {
    await authService.register({ ...input, enrollmentNumber: undefined, verificationNote: '   ' } as any);
    const data = prismaMock.user.create.mock.calls[0][0].data;
    expect(data.enrollmentNumber ?? null).toBeNull();
    expect(data.verificationNote ?? null).toBeNull();
  });
});

describe('sign-in before approval', () => {
  it('refuses a pending registration with 403 ACCOUNT_PENDING_APPROVAL once the password is proven', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'PENDING' }));
    await expect(authService.login(credentials)).rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_PENDING_APPROVAL' });
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('refuses a rejected registration with 403 ACCOUNT_REJECTED', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'REJECTED', approvalNote: 'Not on our rolls' }));
    const error: any = await authService.login(credentials).catch((e) => e);
    expect(error).toMatchObject({ statusCode: 403, code: 'ACCOUNT_REJECTED' });
    expect(error.message).not.toContain('Not on our rolls');
  });

  it('does not tell somebody who does not know the password whether the account is pending', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'PENDING' }));
    await expect(authService.login({ ...credentials, password: 'Wrong#Pass9' })).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('does not start a second-factor challenge for somebody who is not approved', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'PENDING', twoFactorEnabled: true }));
    await expect(authService.login(credentials)).rejects.toMatchObject({ code: 'ACCOUNT_PENDING_APPROVAL' });
  });

  it('still asks for the e-mail address to be verified first when that policy is on', async () => {
    config.auth.requireEmailVerification = true;
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'PENDING', emailVerifiedAt: null, isVerified: false }));
    await expect(authService.login(credentials)).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('signs an approved member in', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'APPROVED', isVerified: true }));
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.refreshToken.create.mockResolvedValue({});
    prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 0 });
    const result: any = await authService.login(credentials);
    expect(result.accessToken).toBeTruthy();
  });

  it('fails closed when the status is missing from the row', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: undefined }));
    await expect(authService.login(credentials)).rejects.toMatchObject({ code: 'ACCOUNT_PENDING_APPROVAL' });
  });
});

describe('the other ways to get a session', () => {
  it('2FA completion refuses somebody who is not approved', async () => {
    prismaMock.user.findUnique.mockResolvedValue(dbUser({ approvalStatus: 'PENDING', twoFactorEnabled: true }));
    await expect(authService.completeLoginAfter2FA('u1')).rejects.toMatchObject({ code: 'ACCOUNT_PENDING_APPROVAL' });
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it('refreshing a token refuses an account that is no longer approved', async () => {
    const value = generateRefreshToken('u1');
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      token: hashToken(value),
      familyId: 'f1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: dbUser({ approvalStatus: 'REJECTED' }),
    });
    prismaMock.refreshToken.deleteMany.mockResolvedValue({ count: 1 });
    await expect(authService.refreshToken(value)).rejects.toMatchObject({ statusCode: 403, code: 'ACCOUNT_REJECTED' });
    expect(prismaMock.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('verifying the e-mail address', () => {
  const arrange = () => {
    prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'vt1', userId: 'u1', user: dbUser() });
    prismaMock.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.update.mockResolvedValue({});
  };

  it('proves the mailbox but does NOT make the person a verified member', async () => {
    arrange();
    await authService.verifyEmail('raw-token', PASSWORD);
    const data = prismaMock.user.update.mock.calls[0][0].data;
    expect(data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(data).not.toHaveProperty('isVerified');
    expect(data).not.toHaveProperty('approvalStatus');
  });

  it('tells the person that an administrator reviews the registration next, instead of "your account is active"', async () => {
    arrange();
    const result = await authService.verifyEmail('raw-token', PASSWORD);
    expect(result.message).toMatch(/administrator/i);
    expect(publishNotificationEvent).toHaveBeenCalledWith('registration.received', { userId: 'u1' });
    expect(sendWelcomeEmail).not.toHaveBeenCalled();
  });

  it('keeps the verification mail for registrations', () => {
    expect(sendVerificationEmail).toBeDefined();
    expect(TOKEN_TYPES.EMAIL_VERIFY).toBe('EMAIL_VERIFY');
  });
});
