/**
 * AU-04: turning 2FA off must need more than a bearer token (a stolen access token would
 *        otherwise strip the second factor in one request).
 * AU-05: the per-account OTP attempt budget must hold under concurrent guesses. The old
 *        "count failures, then verify, then record" sequence let a burst of parallel guesses
 *        all read the same low failure count.
 */
import * as email from '../../../src/utils/email';
import { OTP_MAX_ATTEMPTS, twoFactorService } from '../../../src/services/twoFactorService';
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(() => jest.restoreAllMocks());

describe('AU-04: disabling 2FA requires the account password', () => {
  it('refuses a bare bearer token, a wrong password, and accepts the right one', async () => {
    const { user, auth } = await createUser('MEMBER', { twoFactorEnabled: true });

    const bare = await http().post('/api/auth/2fa/disable').set('Authorization', auth);
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe('PASSWORD_REQUIRED');

    const wrong = await http().post('/api/auth/2fa/disable').set('Authorization', auth).send({ password: 'Wrong#Pass123' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_PASSWORD');
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.twoFactorEnabled).toBe(true);

    const ok = await http().post('/api/auth/2fa/disable').set('Authorization', auth).send({ password: PASSWORD });
    expect(ok.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: user.id } }))?.twoFactorEnabled).toBe(false);
  });
});

describe('AU-05: OTP attempt budget is race-safe', () => {
  it('evaluates at most OTP_MAX_ATTEMPTS guesses out of a parallel burst', async () => {
    jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
    const { user } = await createUser('MEMBER', { twoFactorEnabled: true });
    await twoFactorService.sendOTP(user.id, user.email);

    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () => twoFactorService.verifyOTP(user.id, '000000'))
    );
    const evaluated = results.filter((r) => r.status === 'fulfilled').length;
    const locked = results.filter((r) => r.status === 'rejected').length;

    expect(evaluated).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(locked).toBeGreaterThanOrEqual(40 - OTP_MAX_ATTEMPTS);
  });

  it('is single-use and bound to the issuing user (verified OK)', async () => {
    const sent: string[] = [];
    jest.spyOn(email, 'sendEmail').mockImplementation(async (opts: any) => {
      sent.push(String(opts.html).match(/>\s*(\d{6})\s*</)![1]);
    });
    const a = await createUser('MEMBER', { twoFactorEnabled: true });
    const b = await createUser('MEMBER', { twoFactorEnabled: true });
    await twoFactorService.sendOTP(a.user.id, a.user.email);
    const code = sent[0];

    expect(await twoFactorService.verifyOTP(b.user.id, code)).toBe(false);
    expect(await twoFactorService.verifyOTP(a.user.id, code)).toBe(true);
    expect(await twoFactorService.verifyOTP(a.user.id, code)).toBe(false);
  });
});

describe('2FA login token', () => {
  it('a 2FA challenge cannot be used as an access token (verified OK)', async () => {
    const { user } = await createUser('MEMBER', { twoFactorEnabled: true });
    jest.spyOn(email, 'sendEmail').mockResolvedValue(undefined);
    const login = await http().post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.requires2FA).toBe(true);
    expect(login.body.data.accessToken).toBeUndefined();
    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${login.body.data.twoFactorToken}`);
    expect(me.status).toBe(401);
  });
});
