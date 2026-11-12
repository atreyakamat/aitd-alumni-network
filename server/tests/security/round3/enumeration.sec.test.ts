/**
 * ROUND 3 / C5 - account enumeration: what a stranger can learn about an address from the public auth endpoints, by the answer
 * and by the time it took, for an unknown, a verified, a pending, a rejected and a deactivated account.
 *
 * Documented and accepted: registration says "e-mail already registered" (a registration form cannot do otherwise), and a login
 * that proves the password may say that the account is waiting for approval (only the owner knows the password).
 */
import { createUser, http, prisma, uniqueEmail, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

type Kind = 'unknown' | 'member' | 'pending' | 'rejected' | 'deactivated' | 'no-password';
const KINDS: Kind[] = ['unknown', 'member', 'pending', 'rejected', 'deactivated', 'no-password'];

const addressFor = async (kind: Kind): Promise<string> => {
  switch (kind) {
    case 'unknown':
      return uniqueEmail('nobody');
    case 'member':
      return (await createUser('MEMBER')).user.email;
    case 'pending':
      return (await createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false, emailVerifiedAt: null })).user.email;
    case 'rejected':
      return (await createUser('MEMBER', { approvalStatus: 'REJECTED', isVerified: false })).user.email;
    case 'deactivated':
      return (await createUser('MEMBER', { isActive: false })).user.email;
    case 'no-password':
      return (await createUser('MEMBER', { passwordHash: '' })).user.email;
  }
};

/** The parts of an answer that a stranger can see. */
const view = (res: { status: number; body: Record<string, unknown> }) => ({ status: res.status, body: res.body });

describe('forgot-password and resend-verification answer every address the same way', () => {
  it.each(['/api/auth/forgot-password', '/api/auth/resend-verification'])('%s: same status and body for all kinds of address', async (url) => {
    const answers = [];
    for (const kind of KINDS) {
      const res = await http().post(url).send({ email: await addressFor(kind) });
      answers.push({ kind, ...view(res) });
    }
    const [first, ...rest] = answers;
    expect(first.status).toBe(200);
    for (const other of rest) expect({ kind: other.kind, status: other.status, body: other.body }).toEqual({ kind: other.kind, status: first.status, body: first.body });
  });

  it('upper-case and padded spellings of an address are the same answer, not a different one', async () => {
    const address = await addressFor('member');
    const a = await http().post('/api/auth/forgot-password').send({ email: address });
    const b = await http().post('/api/auth/forgot-password').send({ email: `  ${address.toUpperCase()} ` });
    expect(view(b)).toEqual(view(a));
  });
});

describe('login: a wrong password answers identically whatever the account is', () => {
  it('unknown, member, pending, rejected, deactivated and password-less accounts all give the same 401 for a wrong password', async () => {
    const answers = [];
    for (const kind of KINDS) {
      const res = await http().post('/api/auth/login').send({ email: await addressFor(kind), password: 'Wrong!Passw0rd-123' });
      answers.push({ kind, ...view(res) });
    }
    for (const a of answers) expect({ kind: a.kind, status: a.status, body: a.body }).toEqual({ kind: a.kind, status: 401, body: answers[0].body });
    expect(JSON.stringify(answers[0].body)).toMatch(/INVALID_CREDENTIALS/);
  });

  it('the stage of the account is told only to somebody who proved the password, and never for a password-less or unknown address', async () => {
    const pending = await addressFor('pending');
    const rejected = await addressFor('rejected');
    expect((await http().post('/api/auth/login').send({ email: pending, password: PASSWORD })).body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
    expect((await http().post('/api/auth/login').send({ email: rejected, password: PASSWORD })).body.error.code).toBe('ACCOUNT_REJECTED');
    // an address with no password hash can never be told anything but "invalid"
    const noPassword = await http().post('/api/auth/login').send({ email: await addressFor('no-password'), password: PASSWORD });
    expect(noPassword.status).toBe(401);
    expect(noPassword.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('timing: an unknown address costs the same bcrypt work as a known one (medians within a factor of 2, bcrypt dominates)', async () => {
    const known = await addressFor('member');
    const unknown = uniqueEmail('timing');
    const time = async (email: string) => {
      const t = process.hrtime.bigint();
      await http().post('/api/auth/login').send({ email, password: 'Wrong!Passw0rd-123' });
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    await time(known); // warm up the dummy hash and the connection
    await time(unknown);
    const knownMs: number[] = [];
    const unknownMs: number[] = [];
    for (let i = 0; i < 9; i++) {
      knownMs.push(await time(known));
      unknownMs.push(await time(unknown));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const ratio = median(unknownMs) / median(knownMs);
    expect(median(unknownMs)).toBeGreaterThan(40); // it really did a bcrypt compare (cost 12 is well over 100 ms; a skipped compare is a few ms)
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  });
});

describe('forgot-password timing does not separate known from unknown addresses', () => {
  it('medians are close (the work that differs is a few queries, not a hash)', async () => {
    const known = await addressFor('member');
    const unknown = uniqueEmail('timing2');
    const time = async (email: string) => {
      const t = process.hrtime.bigint();
      await http().post('/api/auth/forgot-password').send({ email });
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    await time(known);
    await time(unknown);
    const knownMs: number[] = [];
    const unknownMs: number[] = [];
    for (let i = 0; i < 9; i++) {
      knownMs.push(await time(known));
      unknownMs.push(await time(unknown));
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    expect(Math.abs(median(knownMs) - median(unknownMs))).toBeLessThan(120);
  });
});

describe('verify-email and reset-password: every bad token looks the same', () => {
  it('unknown, expired, used and wrong-type tokens give one answer', async () => {
    const member = await createUser('MEMBER');
    const crypto = await import('crypto');
    const sha = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
    await prisma.verificationToken.createMany({
      data: [
        { userId: member.user.id, token: sha('expired-r3'), type: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() - 1000) },
        { userId: member.user.id, token: sha('used-r3'), type: 'EMAIL_VERIFY', expiresAt: new Date(Date.now() + 60_000), isUsed: true },
        { userId: member.user.id, token: sha('reset-r3'), type: 'PASSWORD_RESET', expiresAt: new Date(Date.now() + 60_000) },
      ],
    });
    const answers = [];
    for (const token of ['never-issued-r3', 'expired-r3', 'used-r3', 'reset-r3']) {
      const res = await http().post('/api/auth/verify-email').send({ token, password: PASSWORD });
      answers.push({ token, status: res.status, code: res.body?.error?.code, message: res.body?.error?.message });
    }
    for (const a of answers) expect({ ...a, token: '' }).toEqual({ ...answers[0], token: '' });
    expect(answers[0].status).toBe(400);
    expect(answers[0].code).toBe('INVALID_TOKEN');

    const resets = [];
    for (const token of ['never-issued-r3', 'expired-r3', 'used-r3']) {
      const res = await http().post('/api/auth/reset-password').send({ token, password: 'Fresh!Passw0rd-991' });
      resets.push({ status: res.status, code: res.body?.error?.code });
    }
    for (const r of resets) expect(r).toEqual(resets[0]);
  });

  it('a stranger cannot tell a pending account from a rejected one through the profile, search or invitation routes either', async () => {
    const viewer = await createUser('MEMBER');
    const pending = await createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false, fullName: 'Enumerable Pending Person' });
    const rejected = await createUser('MEMBER', { approvalStatus: 'REJECTED', isVerified: false, fullName: 'Enumerable Rejected Person' });
    const ghost = '00000000-0000-4000-8000-0000000000aa';
    const answers = [];
    for (const id of [pending.user.id, rejected.user.id, ghost]) {
      const res = await http().get(`/api/users/${id}`).set('Authorization', viewer.auth);
      answers.push({ status: res.status, code: res.body?.error?.code });
    }
    expect(answers[0]).toEqual(answers[2]);
    expect(answers[1]).toEqual(answers[2]);
    const search = await http().get('/api/search').query({ q: 'Enumerable' }).set('Authorization', viewer.auth);
    expect(JSON.stringify(search.body)).not.toMatch(/Enumerable (Pending|Rejected) Person/);
    const directory = await http().get('/api/users/directory').query({ search: 'Enumerable' }).set('Authorization', viewer.auth);
    expect(JSON.stringify(directory.body)).not.toMatch(/Enumerable (Pending|Rejected) Person/);
  });
});
