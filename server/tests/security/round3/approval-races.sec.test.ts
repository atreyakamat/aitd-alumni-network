/**
 * ROUND 3 / E6 - races around registration and the approval queue: approve against reject at once, a double (and tenfold) approval,
 * a double rejection, and the same address registered by many requests at the same moment.
 */
import { config } from '../../../src/config';
import { createUser, http, prisma, uniqueEmail, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  config.auth.requireEmailVerification = false;
  await prisma.$disconnect();
});

const applicant = () => createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false, emailVerifiedAt: new Date() });
const audits = (userId: string, action: string) => prisma.auditLog.count({ where: { entityType: 'USER', entityId: userId, action } });

describe('the approval queue under concurrent decisions', () => {
  it('ten administrators approving the same registration at once: one 200, nine 409, one audit entry', async () => {
    const admins = await Promise.all(Array.from({ length: 5 }, () => createUser('ADMIN')));
    const target = await applicant();
    const calls = Array.from({ length: 10 }, (_, i) =>
      http().post(`/api/admin/approvals/${target.user.id}/approve`).set('Authorization', admins[i % admins.length].auth).send({ note: `by ${i}` })
    );
    const results = await Promise.all(calls);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(await audits(target.user.id, 'APPROVE')).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } })).approvalStatus).toBe('APPROVED');
  });

  it('several rejections at once: one wins, the others 409, one audit entry', async () => {
    const admin = await createUser('ADMIN');
    const target = await applicant();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => http().post(`/api/admin/approvals/${target.user.id}/reject`).set('Authorization', admin.auth).send({ reason: `cannot verify enrolment ${i}` }))
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await audits(target.user.id, 'REJECT')).toBe(1);
  });

  it('approve and reject at the same moment never leave the account in a state its audit trail does not explain, and never a 5xx', async () => {
    const a = await createUser('ADMIN');
    const b = await createUser('ADMIN');
    for (let round = 0; round < 4; round++) {
      const target = await applicant();
      const [approve, reject] = await Promise.all([
        http().post(`/api/admin/approvals/${target.user.id}/approve`).set('Authorization', a.auth).send({}),
        http().post(`/api/admin/approvals/${target.user.id}/reject`).set('Authorization', b.auth).send({ reason: 'doubtful claim of enrolment' }),
      ]);
      expect(approve.status).toBeLessThan(500);
      expect(reject.status).toBeLessThan(500);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } });
      const log = await prisma.auditLog.findMany({ where: { entityType: 'USER', entityId: target.user.id, action: { in: ['APPROVE', 'REJECT'] } }, orderBy: { createdAt: 'asc' } });
      // every 200 has its audit entry, no more, and the last decision is the state
      expect(log.length).toBe([approve, reject].filter((r) => r.status === 200).length);
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(row.approvalStatus).toBe(log[log.length - 1].action === 'APPROVE' ? 'APPROVED' : 'REJECTED');
      // approved <=> may sign in
      const login = await http().post('/api/auth/login').send({ email: target.user.email, password: PASSWORD });
      expect(login.status).toBe(row.approvalStatus === 'APPROVED' ? 200 : 403);
      expect(row.isVerified).toBe(row.approvalStatus === 'APPROVED');
    }
  });

  it('a decision on an unknown id, an id with a path trick or a non-UUID is a clean 404 or 400', async () => {
    const admin = await createUser('ADMIN');
    for (const id of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid', '..%2F..%2Fadmin', '%00']) {
      for (const action of ['approve', 'reject']) {
        const res = await http().post(`/api/admin/approvals/${id}/${action}`).set('Authorization', admin.auth).send({ reason: 'a reason that is long enough' });
        expect({ id, action, ok: [400, 404].includes(res.status) }).toEqual({ id, action, ok: true });
      }
    }
  });
});

describe('registering the same address at once', () => {
  const register = (email: string, password: string, fullName = 'Racer One') =>
    http().post('/api/auth/register').send({ email, password, fullName, batchYear: 2015, department: 'Civil', degree: 'B.E.' });

  it('verification not required: eight parallel registrations create one account, one 201, seven 409, no 5xx', async () => {
    config.auth.requireEmailVerification = false;
    const email = uniqueEmail('race');
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => register(email, `Race!Passw0rd-${i}x`)));
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  it('upper-case, padded and plus-less spellings of one address are one address', async () => {
    const email = uniqueEmail('Case');
    const results = await Promise.all([email.toUpperCase(), ` ${email} `, email, email.toLowerCase()].map((e, i) => register(e, `Race!Passw0rd-${i}y`)));
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await prisma.user.count({ where: { email: email.toLowerCase() } })).toBe(1);
  });

  it('verification required: parallel registrations replacing a pending one leave exactly one password that works, and one live verification link for it', async () => {
    config.auth.requireEmailVerification = true;
    const email = uniqueEmail('replace-race');
    expect((await register(email, 'First!Passw0rd-1x')).status).toBe(201);
    const passwords = Array.from({ length: 6 }, (_, i) => `Second!Passw0rd-${i}x`);
    const results = await Promise.all(passwords.map((p) => register(email, p)));
    expect(results.every((r) => r.status < 500)).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    const bcrypt = await import('bcryptjs');
    const matches = await Promise.all([...passwords, 'First!Passw0rd-1x'].map((p) => bcrypt.compare(p, row.passwordHash ?? '')));
    expect(matches.filter(Boolean)).toHaveLength(1); // one password, whoever won
    expect(await prisma.verificationToken.count({ where: { userId: row.id, type: 'EMAIL_VERIFY' } })).toBe(1);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });
});
