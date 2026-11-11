/**
 * The college administrator hears about a registration through the notification bus (Kafka), and the applicant hears that it
 * was received. The administrator is told when the registration is READY for review: when the applicant has verified the
 * e-mail address, or at once when verification is not required (local trial).
 */
import { authService } from '../../services/authService';
import { config } from '../../config';
import { prismaMock } from '../../../tests/helpers';
import { hashPassword } from '../../utils/password';
import { log } from '../../utils/logger';
import { publishNotificationEvent } from '../../services/notificationBus';

jest.mock('../../services/notificationBus', () => ({ publishNotificationEvent: jest.fn().mockResolvedValue(undefined) }));

const publish = publishNotificationEvent as jest.Mock;
const PASSWORD = 'Correct#Pass1';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(() => {
  jest.clearAllMocks();
  publish.mockResolvedValue(undefined);
  jest.spyOn(log, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  config.auth.requireEmailVerification = false;
  jest.restoreAllMocks();
});

const input = { email: 'new@aiem.edu', password: PASSWORD, fullName: 'Ada Alum', batchYear: 2015, department: 'CS', degree: 'B.E.' };
const tick = () => new Promise((resolve) => setImmediate(resolve));

const arrangeRegistration = () => {
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.create.mockImplementation(async ({ data }: any) => ({ id: 'u9', ...data }));
  prismaMock.verificationToken.create.mockResolvedValue({});
};

describe('registering', () => {
  it('tells the college administrator at once when e-mail verification is not required', async () => {
    config.auth.requireEmailVerification = false;
    arrangeRegistration();
    await authService.register(input as any);
    expect(publish).toHaveBeenCalledWith('registration.submitted', { applicantId: 'u9' });
  });

  it('waits for the verified address when verification is required: nobody is asked to review an address that may not be the applicant\'s', async () => {
    config.auth.requireEmailVerification = true;
    arrangeRegistration();
    await authService.register(input as any);
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not fail the registration when the event cannot be published', async () => {
    config.auth.requireEmailVerification = false;
    arrangeRegistration();
    publish.mockRejectedValue(new Error('kafka and the fallback are both down'));
    await expect(authService.register(input as any)).resolves.toMatchObject({ approvalStatus: 'PENDING' });
    await tick();
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/registration.submitted/), expect.any(Object));
  });
});

describe('verifying the e-mail address', () => {
  const user = (overrides: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'alum@aiem.edu',
    fullName: 'Ada Alum',
    passwordHash,
    isActive: true,
    isVerified: false,
    emailVerifiedAt: null,
    approvalStatus: 'PENDING',
    ...overrides,
  });
  const arrange = (u = user()) => {
    prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'vt1', userId: u.id, user: u });
    prismaMock.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.user.update.mockResolvedValue({});
  };

  it('tells the applicant it was received and (when verification is required) the administrator that it is ready for review', async () => {
    config.auth.requireEmailVerification = true;
    arrange();
    await authService.verifyEmail('raw-token', PASSWORD);
    expect(publish).toHaveBeenCalledWith('registration.received', { userId: 'u1' });
    expect(publish).toHaveBeenCalledWith('registration.submitted', { applicantId: 'u1' });
  });

  it('does not tell the administrator a second time when verification is not required (they were told at registration)', async () => {
    config.auth.requireEmailVerification = false;
    arrange();
    await authService.verifyEmail('raw-token');
    expect(publish).toHaveBeenCalledWith('registration.received', { userId: 'u1' });
    expect(publish).not.toHaveBeenCalledWith('registration.submitted', expect.anything());
  });

  it('says nothing to somebody who is already approved', async () => {
    arrange(user({ approvalStatus: 'APPROVED' }));
    await authService.verifyEmail('raw-token', PASSWORD);
    expect(publish).not.toHaveBeenCalled();
  });

  it('verifying still succeeds when the events cannot be published', async () => {
    config.auth.requireEmailVerification = true;
    arrange();
    publish.mockRejectedValue(new Error('down'));
    await expect(authService.verifyEmail('raw-token', PASSWORD)).resolves.toEqual({ message: expect.stringMatching(/administrator/i) });
    await tick();
    expect(log.error).toHaveBeenCalled();
  });
});
