import crypto from 'crypto';
import { twoFactorService, OTP_MAX_ATTEMPTS } from '../../services/twoFactorService';
import { prismaMock } from '../../../tests/helpers';
import { sendEmail } from '../../utils/email';
import { config } from '../../config';

const hashFor = (userId: string, otp: string) =>
  crypto.createHmac('sha256', config.jwt.secret).update(`${userId}:${otp}`).digest('hex');

/** Send an OTP and return the plaintext code that was emailed. */
const sendAndCapture = async (userId = 'u1') => {
  await twoFactorService.sendOTP(userId, 'u1@x.io');
  const html: string = (sendEmail as jest.Mock).mock.calls.at(-1)[0].html;
  return html.match(/letter-spacing[^>]*>\s*(\d{6})\s*</)![1];
};

beforeEach(() => jest.clearAllMocks());

describe('twoFactorService', () => {
  describe('sendOTP', () => {
    it('replaces existing codes, stores only a keyed hash with a 10-minute expiry and emails the code', async () => {
      const otp = await sendAndCapture();

      expect(otp).toMatch(/^\d{6}$/);
      expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', type: 'TWO_FACTOR' } });
      const data = prismaMock.verificationToken.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ userId: 'u1', type: 'TWO_FACTOR', token: hashFor('u1', otp) });
      expect(data.token).not.toContain(otp);
      const ttl = data.expiresAt.getTime() - Date.now();
      expect(ttl).toBeGreaterThan(9 * 60_000);
      expect(ttl).toBeLessThanOrEqual(10 * 60_000);
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'u1@x.io', subject: expect.stringContaining('Verification Code') }));
    });

    it('uses a CSPRNG rather than Math.random', async () => {
      const spy = jest.spyOn(Math, 'random');
      await sendAndCapture();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('preserves leading zeros', async () => {
      const spy = jest.spyOn(crypto, 'randomInt').mockImplementation((() => 42) as any);
      const otp = await sendAndCapture();
      expect(otp).toBe('000042');
      spy.mockRestore();
    });
  });

  describe('verifyOTP', () => {
    const arrangeActive = (otp: string, overrides: Record<string, unknown> = {}) =>
      prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'otp1', userId: 'u1', token: hashFor('u1', otp), ...overrides });

    beforeEach(() => {
      prismaMock.verificationToken.count.mockResolvedValue(0);
      prismaMock.verificationToken.updateMany.mockResolvedValue({ count: 1 });
    });

    it('accepts the correct code once, marks it used atomically and clears failure history', async () => {
      arrangeActive('123456');

      await expect(twoFactorService.verifyOTP('u1', '123456')).resolves.toBe(true);

      const where = prismaMock.verificationToken.findFirst.mock.calls[0][0].where;
      expect(where).toMatchObject({ userId: 'u1', type: 'TWO_FACTOR', isUsed: false });
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
      expect(prismaMock.verificationToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'otp1', isUsed: false },
        data: { isUsed: true },
      });
      expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1', type: 'TWO_FACTOR_FAILURE' },
      });
    });

    it('rejects a wrong code and records the failed attempt', async () => {
      arrangeActive('123456');
      await expect(twoFactorService.verifyOTP('u1', '654321')).resolves.toBe(false);
      expect(prismaMock.verificationToken.updateMany).not.toHaveBeenCalled();
      const failure = prismaMock.verificationToken.create.mock.calls[0][0].data;
      expect(failure).toMatchObject({ userId: 'u1', type: 'TWO_FACTOR_FAILURE' });
      expect(failure.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects when there is no active (unexpired, unused) code', async () => {
      prismaMock.verificationToken.findFirst.mockResolvedValue(null);
      await expect(twoFactorService.verifyOTP('u1', '123456')).resolves.toBe(false);
      expect(prismaMock.verificationToken.create).toHaveBeenCalled();
    });

    it('does not accept another user\'s code', async () => {
      // Hash is bound to the user id, so u2's code never matches u1's stored hash
      prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'otp1', userId: 'u1', token: hashFor('u2', '123456') });
      await expect(twoFactorService.verifyOTP('u1', '123456')).resolves.toBe(false);
    });

    it.each([['non-numeric', 'abcdef'], ['empty', ''], ['non-string', 123456 as unknown as string]])(
      'rejects %s input as a failed attempt',
      async (_label, otp) => {
        arrangeActive('123456');
        await expect(twoFactorService.verifyOTP('u1', otp)).resolves.toBe(false);
        expect(prismaMock.verificationToken.create).toHaveBeenCalled();
      }
    );

    it('rejects a code redeemed concurrently by another request', async () => {
      arrangeActive('123456');
      prismaMock.verificationToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(twoFactorService.verifyOTP('u1', '123456')).resolves.toBe(false);
    });

    it(`locks out with 429 after ${OTP_MAX_ATTEMPTS} failures, even for the right code`, async () => {
      prismaMock.verificationToken.count.mockResolvedValue(OTP_MAX_ATTEMPTS);
      arrangeActive('123456');
      await expect(twoFactorService.verifyOTP('u1', '123456')).rejects.toMatchObject({
        statusCode: 429,
        code: 'OTP_ATTEMPTS_EXCEEDED',
      });
      expect(prismaMock.verificationToken.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.verificationToken.updateMany).not.toHaveBeenCalled();
    });

    it('burns the outstanding code when the final allowed attempt fails', async () => {
      prismaMock.verificationToken.count.mockResolvedValueOnce(OTP_MAX_ATTEMPTS - 1).mockResolvedValueOnce(OTP_MAX_ATTEMPTS);
      arrangeActive('123456');
      await expect(twoFactorService.verifyOTP('u1', '000000')).resolves.toBe(false);
      expect(prismaMock.verificationToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', type: 'TWO_FACTOR' } });
    });

    it('counts only failures still inside the lockout window', async () => {
      arrangeActive('123456');
      await twoFactorService.verifyOTP('u1', '123456');
      const where = prismaMock.verificationToken.count.mock.calls[0][0].where;
      expect(where).toMatchObject({ userId: 'u1', type: 'TWO_FACTOR_FAILURE' });
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
    });

    it('verifies a code produced by sendOTP end-to-end', async () => {
      const otp = await sendAndCapture();
      const stored = prismaMock.verificationToken.create.mock.calls[0][0].data;
      prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'otp1', ...stored });
      await expect(twoFactorService.verifyOTP('u1', ` ${otp} `)).resolves.toBe(true);
    });
  });

  describe('resendOTP', () => {
    it('sends a fresh code to the account email', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ email: 'u1@x.io', isActive: true, twoFactorEnabled: true });
      prismaMock.verificationToken.findFirst.mockResolvedValue(null);
      await expect(twoFactorService.resendOTP('u1')).resolves.toEqual({ message: 'Verification code sent to your email' });
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'u1@x.io' }));
    });

    it('throttles resends inside the cooldown with 429', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ email: 'u1@x.io', isActive: true, twoFactorEnabled: true });
      prismaMock.verificationToken.findFirst.mockResolvedValue({ id: 'otp1' });
      await expect(twoFactorService.resendOTP('u1')).rejects.toMatchObject({ statusCode: 429, code: 'OTP_RESEND_TOO_SOON' });
      expect(sendEmail).not.toHaveBeenCalled();
      expect(prismaMock.verificationToken.findFirst.mock.calls[0][0].where.createdAt.gt).toBeInstanceOf(Date);
    });

    it.each([
      ['missing', null],
      ['deactivated', { email: 'u1@x.io', isActive: false, twoFactorEnabled: true }],
      ['2FA disabled', { email: 'u1@x.io', isActive: true, twoFactorEnabled: false }],
    ])('refuses when the user is %s', async (_label, user) => {
      prismaMock.user.findUnique.mockResolvedValue(user);
      await expect(twoFactorService.resendOTP('u1')).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_2FA_SESSION' });
      expect(sendEmail).not.toHaveBeenCalled();
    });
  });

  describe('enable / disable / status', () => {
    it('enables and disables 2FA for the given user', async () => {
      await expect(twoFactorService.enable2FA('u1')).resolves.toEqual({ message: 'Two-factor authentication enabled' });
      expect(prismaMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { twoFactorEnabled: true } });
      await expect(twoFactorService.disable2FA('u1')).resolves.toEqual({ message: 'Two-factor authentication disabled' });
      expect(prismaMock.user.update).toHaveBeenLastCalledWith({ where: { id: 'u1' }, data: { twoFactorEnabled: false } });
    });

    it('reports status, defaulting to false for unknown users', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce({ twoFactorEnabled: true }).mockResolvedValueOnce(null);
      await expect(twoFactorService.is2FAEnabled('u1')).resolves.toBe(true);
      await expect(twoFactorService.is2FAEnabled('ghost')).resolves.toBe(false);
    });
  });
});
