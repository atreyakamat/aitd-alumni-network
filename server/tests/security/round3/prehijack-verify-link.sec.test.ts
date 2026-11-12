/**
 * ROUND 3 / A1 (R3-06) - pre-hijack through the verification link, with REQUIRE_EMAIL_VERIFICATION on AND off.
 *
 * Attack: the attacker registers the VICTIM's address with a password the attacker chose. The victim gets a verification mail
 * they did not ask for. If the victim clicks it, the account becomes "verified"; the attacker's password and the attacker's
 * registration details (name, enrolment number, note) are still what the account holds.
 *
 * Invariant under test, for both settings: a verification link never turns somebody else's registration into the mailbox
 * owner's account. The link needs the registration password (the client page always asked for it; round 2 enforced it only
 * when verification is required), and the way the owner takes the address back is "Forgot password", which kills the
 * attacker's password and sessions.
 */
import { config } from '../../../src/config';
import { createUser, http, prisma, uniqueEmail } from '../../integration/helpers';

jest.mock('../../../src/utils/email', () => {
  const actual = jest.requireActual('../../../src/utils/email');
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    mocked[key] = typeof actual[key] === 'function' ? jest.fn().mockResolvedValue(undefined) : actual[key];
  }
  return { __esModule: true, ...mocked };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mail = require('../../../src/utils/email') as { sendVerificationEmail: jest.Mock; sendPasswordResetEmail: jest.Mock };

const ATTACKER_PASSWORD = 'Attacker!Pass99x';
const VICTIM_PASSWORD = 'Victim!Passw0rd77';

afterAll(async () => {
  config.auth.requireEmailVerification = false;
  await prisma.$disconnect();
});

beforeEach(() => {
  mail.sendVerificationEmail.mockClear();
  mail.sendPasswordResetEmail.mockClear();
});

const register = (address: string, password: string, extra: Record<string, unknown> = {}) =>
  http().post('/api/auth/register').send({
    email: address,
    password,
    fullName: 'Mallory',
    batchYear: 2015,
    department: 'Civil',
    degree: 'B.E.',
    enrollmentNumber: 'ATTACKER-ENROL-1',
    verificationNote: 'I am definitely the owner of this address',
    ...extra,
  });
const login = (address: string, password: string) => http().post('/api/auth/login').send({ email: address, password });
const lastToken = (fn: jest.Mock): string => fn.mock.calls[fn.mock.calls.length - 1][2];
const settle = () => new Promise((resolve) => setTimeout(resolve, 250)); // mails are sent after the response

describe.each([
  ['required (production default)', true],
  ['not required (local trial)', false],
])('REQUIRE_EMAIL_VERIFICATION %s', (_label, required) => {
  beforeAll(() => {
    config.auth.requireEmailVerification = required;
  });

  it('the victim clicking the unsolicited link, with no password or with a guess, verifies nothing and burns nothing', async () => {
    const victim = uniqueEmail('victim');
    expect((await register(victim, ATTACKER_PASSWORD)).status).toBe(201);
    await settle();
    const unsolicited = lastToken(mail.sendVerificationEmail);

    const bare = await http().post('/api/auth/verify-email').send({ token: unsolicited });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe('PASSWORD_REQUIRED');

    const guess = await http().post('/api/auth/verify-email').send({ token: unsolicited, password: VICTIM_PASSWORD });
    expect(guess.status).toBe(400);
    expect(guess.body.error.code).toBe('VERIFY_PASSWORD_INVALID');

    const row = await prisma.user.findUniqueOrThrow({ where: { email: victim } });
    expect(row.emailVerifiedAt).toBeNull();
    expect(row.isVerified).toBe(false);
    expect(row.approvalStatus).toBe('PENDING');
  });

  it('whatever the attacker does, their password never yields a session while the account is unapproved', async () => {
    const victim = uniqueEmail('victim');
    await register(victim, ATTACKER_PASSWORD);
    const res = await login(victim, ATTACKER_PASSWORD);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/);
    expect(['EMAIL_NOT_VERIFIED', 'ACCOUNT_PENDING_APPROVAL']).toContain(res.body.error.code);
  });

  it('the owner takes the address back with "Forgot password": the attacker password is dead, sessions are revoked, and only then can the owner verify', async () => {
    const victim = uniqueEmail('victim');
    await register(victim, ATTACKER_PASSWORD);
    await settle();
    const before = await prisma.user.findUniqueOrThrow({ where: { email: victim } });

    expect((await http().post('/api/auth/forgot-password').send({ email: victim })).status).toBe(200);
    await settle();
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledTimes(1);
    const reset = await http().post('/api/auth/reset-password').send({ token: lastToken(mail.sendPasswordResetEmail), password: VICTIM_PASSWORD });
    expect(reset.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { email: victim } });
    expect(after.tokenVersion).toBeGreaterThan(before.tokenVersion);
    expect((await login(victim, ATTACKER_PASSWORD)).status).toBe(401);
    // the owner's password is the only one that reaches the next step (verification, or the approval queue)
    const owner = await login(victim, VICTIM_PASSWORD);
    expect(owner.status).toBe(403);
    expect(['EMAIL_NOT_VERIFIED', 'ACCOUNT_PENDING_APPROVAL']).toContain(owner.body.error.code);

    // a verification mail requested now is confirmed with the owner's password and no other
    await prisma.verificationToken.deleteMany({ where: { userId: after.id, type: 'EMAIL_VERIFY' } });
    mail.sendVerificationEmail.mockClear();
    await http().post('/api/auth/resend-verification').send({ email: victim });
    await settle();
    const fresh = lastToken(mail.sendVerificationEmail);
    expect((await http().post('/api/auth/verify-email').send({ token: fresh, password: ATTACKER_PASSWORD })).status).toBe(400);
    expect((await http().post('/api/auth/verify-email').send({ token: fresh, password: VICTIM_PASSWORD })).status).toBe(200);
  });

  it('a link that was spent cannot be replayed, and a link for another account does not verify this one', async () => {
    const a = uniqueEmail('a');
    const b = uniqueEmail('b');
    await register(a, VICTIM_PASSWORD, { fullName: 'Alice A' });
    await settle();
    const tokenA = lastToken(mail.sendVerificationEmail);
    await register(b, VICTIM_PASSWORD, { fullName: 'Bobby B' });
    await settle();
    const tokenB = lastToken(mail.sendVerificationEmail);
    expect((await http().post('/api/auth/verify-email').send({ token: tokenA, password: VICTIM_PASSWORD })).status).toBe(200);
    expect((await http().post('/api/auth/verify-email').send({ token: tokenA, password: VICTIM_PASSWORD })).status).toBe(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: b } })).emailVerifiedAt).toBeNull();
    expect(tokenA).not.toBe(tokenB);
  });
});

describe('with verification required: approval of a mailbox nobody has proven', () => {
  beforeAll(() => {
    config.auth.requireEmailVerification = true;
  });

  it('an administrator cannot approve the attacker registration while the mailbox is unverified', async () => {
    const victim = uniqueEmail('victim');
    await register(victim, ATTACKER_PASSWORD);
    const admin = await createUser('ADMIN');
    const row = await prisma.user.findUniqueOrThrow({ where: { email: victim } });
    const res = await http().post(`/api/admin/approvals/${row.id}/approve`).set('Authorization', admin.auth).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: row.id } })).approvalStatus).toBe('PENDING');
  });

  it('registering the address again replaces the attacker registration: password, name, enrolment number and note are all the owner\'s', async () => {
    const victim = uniqueEmail('victim');
    await register(victim, ATTACKER_PASSWORD);
    const second = await register(victim, VICTIM_PASSWORD, { fullName: 'Real Owner', enrollmentNumber: 'OWNER-1', verificationNote: 'my note' });
    expect(second.status).toBe(201);
    const row = await prisma.user.findUniqueOrThrow({ where: { email: victim } });
    expect(row.fullName).toBe('Real Owner');
    expect(row.enrollmentNumber).toBe('OWNER-1');
    expect(row.verificationNote).toBe('my note');
    expect((await login(victim, ATTACKER_PASSWORD)).status).toBe(401);
  });
});
