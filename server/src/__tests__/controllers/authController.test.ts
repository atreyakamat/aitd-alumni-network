import { authController } from '../../controllers/authController';
import { authService } from '../../services/authService';
import { twoFactorService } from '../../services/twoFactorService';
import { AppError } from '../../middleware/errorHandler';
import { mockReqRes } from '../../../tests/helpers';
import { generateAccessToken, generateTwoFactorToken } from '../../utils/jwt';

const session = { accessToken: 'a', refreshToken: 'r', user: { id: 'u1', email: 'u1@x.io' } };

afterEach(() => {
  jest.restoreAllMocks();
  // restoreAllMocks also undoes the harness's console silencing
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

/** Run a handler and return the error passed to next(), if any. */
const run = async (handler: keyof typeof authController, req: Record<string, unknown> = {}) => {
  const ctx = mockReqRes(req);
  await (authController as any)[handler](ctx.req, ctx.res, ctx.next);
  return { ...ctx, error: ctx.next.mock.calls[0]?.[0] };
};

describe('authController', () => {
  describe('simple delegating handlers', () => {
    it.each([
      ['register', 'register', { body: { email: 'x' } }, 201],
      ['verifyEmail', 'verifyEmail', { body: { token: 't' } }, 200],
      ['forgotPassword', 'forgotPassword', { body: { email: 'x' } }, 200],
      ['resetPassword', 'resetPassword', { body: { token: 't', password: 'p' } }, 200],
      ['refreshToken', 'refreshToken', { body: { refreshToken: 'r' } }, 200],
      ['logout', 'logout', { body: { refreshToken: 'r' }, user: { id: 'u1' } }, 200],
      ['changePassword', 'changePassword', { body: { currentPassword: 'a', newPassword: 'b' }, user: { id: 'u1' } }, 200],
      ['me', 'getProfile', { user: { id: 'u1' } }, 200],
    ] as const)('%s wraps the service result in {success, data}', async (handler, method, req, status) => {
      jest.spyOn(authService, method as any).mockResolvedValue({ ok: true } as any);
      const { res, error } = await run(handler as any, req as any);
      expect(error).toBeUndefined();
      if (status === 201) expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { ok: true } });
    });

    it('passes the right arguments to the service', async () => {
      const reset = jest.spyOn(authService, 'resetPassword').mockResolvedValue({ message: '' });
      const logout = jest.spyOn(authService, 'logout').mockResolvedValue({ message: '' });
      await run('resetPassword', { body: { token: 't', password: 'P' } });
      await run('logout', { body: { refreshToken: 'r' }, user: { id: 'u1' } });
      expect(reset).toHaveBeenCalledWith('t', 'P');
      expect(logout).toHaveBeenCalledWith('u1', 'r');
    });

    it('changePassword passes the caller, both passwords and request metadata', async () => {
      const change = jest.spyOn(authService, 'changePassword').mockResolvedValue({} as any);
      await run('changePassword', {
        body: { currentPassword: 'Old#1aaaa', newPassword: 'New#1aaaa' },
        user: { id: 'u1' },
        ip: '10.0.0.1',
        headers: { 'user-agent': 'jest' },
      });
      expect(change).toHaveBeenCalledWith('u1', 'Old#1aaaa', 'New#1aaaa', { ipAddress: '10.0.0.1', userAgent: 'jest' });
    });

    it.each(['register', 'verifyEmail', 'forgotPassword', 'resetPassword', 'changePassword', 'refreshToken', 'logout', 'me'] as const)(
      '%s forwards service errors to next()',
      async (handler) => {
        const method = handler === 'me' ? 'getProfile' : handler;
        const boom = new AppError('nope', 400, 'X');
        jest.spyOn(authService, method as any).mockRejectedValue(boom);
        const { res, error } = await run(handler, { user: { id: 'u1' } });
        expect(error).toBe(boom);
        expect(res.json).not.toHaveBeenCalled();
      }
    );
  });

  describe('login', () => {
    it('returns the session when 2FA is off', async () => {
      jest.spyOn(authService, 'login').mockResolvedValue(session as any);
      const send = jest.spyOn(twoFactorService, 'sendOTP');
      const { res } = await run('login', { body: { email: 'e', password: 'p' } });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: session });
      expect(send).not.toHaveBeenCalled();
    });

    it('sends an OTP and returns a challenge token (never session tokens) when 2FA is on', async () => {
      jest.spyOn(authService, 'login').mockResolvedValue({
        requires2FA: true,
        twoFactorToken: 'challenge',
        user: { id: 'u1', email: 'u1@x.io', fullName: 'U', twoFactorEnabled: true },
      });
      const send = jest.spyOn(twoFactorService, 'sendOTP').mockResolvedValue({ message: '' });

      const { res } = await run('login', { body: {} });

      expect(send).toHaveBeenCalledWith('u1', 'u1@x.io');
      const body = res.json.mock.calls[0][0];
      expect(body).toEqual({
        success: true,
        data: { requires2FA: true, userId: 'u1', twoFactorToken: 'challenge', message: expect.any(String) },
      });
      expect(body.data.accessToken).toBeUndefined();
    });

    it('forwards login errors', async () => {
      const boom = new AppError('bad', 401, 'INVALID_CREDENTIALS');
      jest.spyOn(authService, 'login').mockRejectedValue(boom);
      const { error } = await run('login', { body: {} });
      expect(error).toBe(boom);
    });
  });

  describe('verify2FA', () => {
    it('derives the user from the challenge token and completes login', async () => {
      const verify = jest.spyOn(twoFactorService, 'verifyOTP').mockResolvedValue(true);
      const complete = jest.spyOn(authService, 'completeLoginAfter2FA').mockResolvedValue(session as any);

      const { res, error } = await run('verify2FA', {
        body: { twoFactorToken: generateTwoFactorToken('u1'), otp: '123456', userId: 'attacker-chosen' },
      });

      expect(error).toBeUndefined();
      expect(verify).toHaveBeenCalledWith('u1', '123456');
      expect(complete).toHaveBeenCalledWith('u1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: session });
    });

    it('cannot be driven by a bare userId (password step must have happened)', async () => {
      const verify = jest.spyOn(twoFactorService, 'verifyOTP');
      const { error } = await run('verify2FA', { body: { userId: 'u1', otp: '123456' } });
      expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(verify).not.toHaveBeenCalled();
    });

    it('requires the OTP', async () => {
      const { error } = await run('verify2FA', { body: { twoFactorToken: generateTwoFactorToken('u1') } });
      expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    });

    it('rejects forged / non-challenge tokens with 401', async () => {
      const verify = jest.spyOn(twoFactorService, 'verifyOTP');
      const { error } = await run('verify2FA', {
        body: { twoFactorToken: generateAccessToken('u1', 'u1@x.io', 'MEMBER'), otp: '123456' },
      });
      expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_2FA_SESSION' });
      expect(verify).not.toHaveBeenCalled();
    });

    it('rejects a wrong code with 400 INVALID_OTP and issues no session', async () => {
      jest.spyOn(twoFactorService, 'verifyOTP').mockResolvedValue(false);
      const complete = jest.spyOn(authService, 'completeLoginAfter2FA');
      const { error } = await run('verify2FA', { body: { twoFactorToken: generateTwoFactorToken('u1'), otp: '000000' } });
      expect(error).toMatchObject({ statusCode: 400, code: 'INVALID_OTP' });
      expect(complete).not.toHaveBeenCalled();
    });

    it('propagates the attempt lockout', async () => {
      const lock = new AppError('locked', 429, 'OTP_ATTEMPTS_EXCEEDED');
      jest.spyOn(twoFactorService, 'verifyOTP').mockRejectedValue(lock);
      const { error } = await run('verify2FA', { body: { twoFactorToken: generateTwoFactorToken('u1'), otp: '000000' } });
      expect(error).toBe(lock);
    });
  });

  describe('resend2FA', () => {
    it('resends for the user in the challenge token', async () => {
      const resend = jest.spyOn(twoFactorService, 'resendOTP').mockResolvedValue({ message: '' });
      const { res, error } = await run('resend2FA', { body: { twoFactorToken: generateTwoFactorToken('u1') } });
      expect(error).toBeUndefined();
      expect(resend).toHaveBeenCalledWith('u1');
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Verification code sent to your email' });
    });

    it('refuses a bare userId (prevents OTP mail-bombing arbitrary users)', async () => {
      const resend = jest.spyOn(twoFactorService, 'resendOTP');
      const { error } = await run('resend2FA', { body: { userId: 'u1' } });
      expect(error).toMatchObject({ statusCode: 400 });
      expect(resend).not.toHaveBeenCalled();
    });

    it('rejects an invalid challenge token', async () => {
      const { error } = await run('resend2FA', { body: { twoFactorToken: 'junk' } });
      expect(error).toMatchObject({ statusCode: 401, code: 'INVALID_2FA_SESSION' });
    });
  });

  describe('enable2FA / disable2FA', () => {
    it.each(['enable2FA', 'disable2FA'] as const)('%s acts on the authenticated user only', async (handler) => {
      const spy = jest.spyOn(twoFactorService, handler).mockResolvedValue({ message: 'ok' });
      const { res } = await run(handler, { user: { id: 'u1' }, body: { userId: 'someone-else' } });
      expect(spy).toHaveBeenCalledWith('u1');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { message: 'ok' } });
    });

    it.each(['enable2FA', 'disable2FA'] as const)('%s forwards errors', async (handler) => {
      const boom = new Error('db');
      jest.spyOn(twoFactorService, handler).mockRejectedValue(boom);
      const { error } = await run(handler, { user: { id: 'u1' } });
      expect(error).toBe(boom);
    });
  });

  it('getOAuthProviders reports unconfigured providers as false', async () => {
    const { res } = await run('getOAuthProviders');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { google: false, linkedin: false } });
  });

  describe('exchangeOAuthCode', () => {
    it('exchanges a code for a session', async () => {
      const spy = jest.spyOn(authService, 'exchangeOAuthCode').mockResolvedValue(session as any);
      const { res } = await run('exchangeOAuthCode', { body: { code: 'abc' } });
      expect(spy).toHaveBeenCalledWith('abc');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: session });
    });

    it.each([[{}], [{ code: '' }], [{ code: { $ne: null } }]])('rejects a missing/non-string code %j', async (body) => {
      const spy = jest.spyOn(authService, 'exchangeOAuthCode');
      const { error } = await run('exchangeOAuthCode', { body });
      expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('forwards service errors', async () => {
      const boom = new AppError('used', 400, 'INVALID_CODE');
      jest.spyOn(authService, 'exchangeOAuthCode').mockRejectedValue(boom);
      const { error } = await run('exchangeOAuthCode', { body: { code: 'abc' } });
      expect(error).toBe(boom);
    });
  });

  describe.each([
    ['googleCallback', 'google'],
    ['linkedinCallback', 'linkedin'],
  ] as const)('%s', (handler, provider) => {
    it('redirects with a one-time code (never JWTs) in the URL', async () => {
      jest.spyOn(authService, 'createOAuthExchangeCode').mockResolvedValue('one-time');
      const { res } = await run(handler, { user: { id: 'u1', email: 'e', fullName: 'f', isNewUser: false } });
      const url = new URL(res.redirect.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe('http://localhost:3000/login');
      expect(url.searchParams.get('code')).toBe('one-time');
      expect(url.searchParams.get('oauth')).toBe(provider);
      expect(url.searchParams.has('newUser')).toBe(false);
      expect(url.search).not.toMatch(/accessToken|refreshToken/);
    });

    it('flags new users', async () => {
      jest.spyOn(authService, 'createOAuthExchangeCode').mockResolvedValue('c');
      const { res } = await run(handler, { user: { id: 'u1', isNewUser: true } });
      expect(new URL(res.redirect.mock.calls[0][0]).searchParams.get('newUser')).toBe('true');
    });

    it('redirects to an error when no OAuth user is present', async () => {
      const { res } = await run(handler, {});
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/login?error=oauth_failed');
    });

    it('redirects to an error when code creation fails', async () => {
      jest.spyOn(authService, 'createOAuthExchangeCode').mockRejectedValue(new Error('db'));
      const { res, next } = await run(handler, { user: { id: 'u1' } });
      expect(res.redirect).toHaveBeenCalledWith('http://localhost:3000/login?error=oauth_failed');
      expect(next).not.toHaveBeenCalled();
    });
  });
});
