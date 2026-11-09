/**
 * AU-01b: account pre-hijacking through the e-mail verification link (REQUIRE_EMAIL_VERIFICATION, on in production).
 *
 * Attack: the attacker registers the VICTIM's address with a password the attacker chose. The victim receives a
 * verification mail they never asked for. Before this control, clicking it verified the account and left the
 * attacker's password working: a ready-made login into "the victim's" account.
 *
 * What must hold, against the real database and the real HTTP stack:
 *  - the attacker cannot sign in before the address is verified
 *  - the victim cannot be tricked into verifying the attacker's registration (the link needs the registration password)
 *  - the real owner is never locked out of their own address: registering again replaces the pending registration
 *  - a verified account cannot be taken over by registering again
 *  - "resend" does not reveal which addresses exist and cannot flood an inbox
 *  - signing in with Google/LinkedIn does not skip the second factor
 */
import { config } from '../../../src/config';
import { authService } from '../../../src/services/authService';
import { createUser, http, prisma, uniqueEmail, PASSWORD } from '../../integration/helpers';

jest.mock('../../../src/utils/email', () => {
  const actual = jest.requireActual('../../../src/utils/email');
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = typeof actual[key] === 'function' ? jest.fn().mockResolvedValue(undefined) : actual[key];
  }
  return { __esModule: true, ...mocked };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const email = require('../../../src/utils/email') as { sendVerificationEmail: jest.Mock };

const ATTACKER_PASSWORD = 'Attacker!Pass99x';
const VICTIM_PASSWORD = 'Victim!Passw0rd77';

beforeAll(() => {
  config.auth.requireEmailVerification = true;
});

afterAll(async () => {
  config.auth.requireEmailVerification = false;
  await prisma.$disconnect();
});

beforeEach(() => email.sendVerificationEmail.mockClear());

const register = (address: string, password: string, fullName = 'Someone') =>
  http().post('/api/auth/register').send({
    email: address,
    password,
    fullName,
    batchYear: 2015,
    department: 'Civil',
    degree: 'B.E.',
  });

const login = (address: string, password: string) => http().post('/api/auth/login').send({ email: address, password });

/** The raw token of the most recent verification mail (only its hash is stored). */
const lastMailedToken = (): string => {
  const calls = email.sendVerificationEmail.mock.calls;
  return calls[calls.length - 1][2];
};

describe('pre-hijacking through the verification link', () => {
  it('the attacker gets no session, and the victim cannot be talked into verifying the attacker registration', async () => {
    const victimAddress = uniqueEmail('victim');

    // 1. attacker registers the victim's address with their own password
    expect((await register(victimAddress, ATTACKER_PASSWORD, 'Attacker')).status).toBe(201);
    const unsolicitedToken = lastMailedToken(); // lands in the VICTIM's inbox

    // 2. the attacker cannot use the account: not verified
    const attackerLogin = await login(victimAddress, ATTACKER_PASSWORD);
    expect(attackerLogin.status).toBe(403);
    expect(attackerLogin.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect(attackerLogin.body.data).toBeUndefined();

    // 3. the victim opens the unsolicited link: no password, or a guess, does not verify anything
    const noPassword = await http().post('/api/auth/verify-email').send({ token: unsolicitedToken });
    expect(noPassword.status).toBe(400);
    expect(noPassword.body.error.code).toBe('PASSWORD_REQUIRED');

    const guess = await http().post('/api/auth/verify-email').send({ token: unsolicitedToken, password: VICTIM_PASSWORD });
    expect(guess.status).toBe(400);
    expect(guess.body.error.code).toBe('VERIFY_PASSWORD_INVALID');

    // 4. the account is still unusable for the attacker, and the link is not spent
    const row = await prisma.user.findUnique({ where: { email: victimAddress } });
    expect(row?.isVerified).toBe(false);
    expect(row?.emailVerifiedAt).toBeNull();
    expect((await login(victimAddress, ATTACKER_PASSWORD)).status).toBe(403);
  });

  it('the real owner is not locked out: registering again replaces the pending registration and kills the old password and link', async () => {
    const address = uniqueEmail('owner');
    await register(address, ATTACKER_PASSWORD, 'Attacker');
    const attackerToken = lastMailedToken();

    // the owner signs up for real with their own password
    const second = await register(address, VICTIM_PASSWORD, 'Real Owner');
    expect(second.status).toBe(201);
    const ownerToken = lastMailedToken();
    expect(ownerToken).not.toBe(attackerToken);

    // the attacker's password and link are dead
    expect((await login(address, ATTACKER_PASSWORD)).status).toBe(401);
    const stale = await http().post('/api/auth/verify-email').send({ token: attackerToken, password: ATTACKER_PASSWORD });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('INVALID_TOKEN');

    // the owner verifies with their own password and can sign in
    const verified = await http().post('/api/auth/verify-email').send({ token: ownerToken, password: VICTIM_PASSWORD });
    expect(verified.status).toBe(200);
    // verifying the address proves the mailbox; it does not make the person a member (an administrator does that)
    expect((await login(address, VICTIM_PASSWORD)).body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
    await prisma.user.update({ where: { email: address }, data: { approvalStatus: 'APPROVED', isVerified: true } });
    const session = await login(address, VICTIM_PASSWORD);
    expect(session.status).toBe(200);
    expect(session.body.data.accessToken).toEqual(expect.any(String));
    expect(session.body.data.user.fullName).toBe('Real Owner');

    // and still nobody can sign in with the attacker's password
    expect((await login(address, ATTACKER_PASSWORD)).status).toBe(401);
  });

  it('a verified account cannot be taken over by registering the address again', async () => {
    const { user } = await createUser('MEMBER');

    const takeover = await register(user.email, ATTACKER_PASSWORD, 'Attacker');
    expect(takeover.status).toBe(409);
    expect(takeover.body.error.code).toBe('EMAIL_EXISTS');

    expect((await login(user.email, ATTACKER_PASSWORD)).status).toBe(401);
    expect((await login(user.email, PASSWORD)).status).toBe(200);
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('a member who was already using an unverified account (it predates the policy) cannot be locked out by a stranger, and verifies with their own password', async () => {
    const { user } = await createUser('MEMBER', { isVerified: false, emailVerifiedAt: null, lastLoginAt: new Date() });

    // a stranger registers the member's address
    const attempt = await register(user.email, ATTACKER_PASSWORD, 'Stranger');
    expect(attempt.status).toBe(409);
    expect(email.sendVerificationEmail).not.toHaveBeenCalled();

    // the account is untouched: same name, same password hash
    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.fullName).toBe(user.fullName);
    expect(row?.passwordHash).toBe(user.passwordHash);

    // the member is asked to verify, asks for a link, and confirms with the password they already have
    expect((await login(user.email, PASSWORD)).status).toBe(403);
    await prisma.verificationToken.deleteMany({ where: { userId: user.id } });
    await http().post('/api/auth/resend-verification').send({ email: user.email });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const confirmed = await http().post('/api/auth/verify-email').send({ token: lastMailedToken(), password: PASSWORD });
    expect(confirmed.status).toBe(200);
    expect((await login(user.email, PASSWORD)).status).toBe(200);
  });

  it('wrong passwords through the link are counted per account; once spent, even the right one waits', async () => {
    const address = uniqueEmail('guess');
    await register(address, VICTIM_PASSWORD);
    const token = lastMailedToken();

    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await http().post('/api/auth/verify-email').send({ token, password: `Wrong!Guess${i}x1` });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
    expect(statuses.slice(5)).toEqual([429, 429]);

    const right = await http().post('/api/auth/verify-email').send({ token, password: VICTIM_PASSWORD });
    expect(right.status).toBe(429);
    expect((await prisma.user.findUnique({ where: { email: address } }))?.isVerified).toBe(false);
  });
});

describe('resend verification', () => {
  it('answers every address the same way and only mails real unverified accounts, once a minute', async () => {
    const pending = uniqueEmail('pending');
    await register(pending, VICTIM_PASSWORD);
    // the registration mail is older than the cool-down
    await prisma.verificationToken.updateMany({
      where: { user: { email: pending } },
      data: { createdAt: new Date(Date.now() - 5 * 60 * 1000) },
    });
    email.sendVerificationEmail.mockClear();
    const { user: verified } = await createUser('MEMBER');

    const answers = [];
    for (const address of [pending, verified.email, uniqueEmail('nobody')]) {
      const res = await http().post('/api/auth/resend-verification').send({ email: address });
      expect(res.status).toBe(200);
      answers.push(res.body);
    }
    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);

    await new Promise((resolve) => setTimeout(resolve, 200)); // the mail is sent after the response
    expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(email.sendVerificationEmail.mock.calls[0][0]).toBe(pending);

    // a second request inside the cool-down sends nothing
    await http().post('/api/auth/resend-verification').send({ email: pending });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);

    // the new link works with the registration password, the old one is gone
    const fresh = lastMailedToken();
    const done = await http().post('/api/auth/verify-email').send({ token: fresh, password: VICTIM_PASSWORD });
    expect(done.status).toBe(200);
  });

  it('rejects a malformed address', async () => {
    const res = await http().post('/api/auth/resend-verification').send({ email: 'not-an-address' });
    expect(res.status).toBe(400);
  });
});

describe('signing in with a provider does not skip the second factor', () => {
  it('exchanges the code for a 2FA challenge, not for tokens', async () => {
    const { user } = await createUser('MEMBER', { twoFactorEnabled: true });
    const code = await authService.createOAuthExchangeCode(user.id);

    const res = await http().post('/api/auth/oauth/exchange').send({ code });

    expect(res.status).toBe(200);
    expect(res.body.data.requires2FA).toBe(true);
    expect(res.body.data.twoFactorToken).toEqual(expect.any(String));
    expect(res.body.data.accessToken).toBeUndefined();
    expect(res.body.data.refreshToken).toBeUndefined();

    // the challenge alone opens nothing
    const guess = await http().post('/api/auth/verify-2fa').send({ twoFactorToken: res.body.data.twoFactorToken, otp: '000000' });
    expect(guess.status).toBe(400);
    expect(guess.body.data?.accessToken).toBeUndefined();

    // and the single-use code cannot be replayed
    const replay = await http().post('/api/auth/oauth/exchange').send({ code });
    expect(replay.status).toBe(400);
  });
});
