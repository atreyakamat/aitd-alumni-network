/**
 * Alumni approval against a real PostgreSQL database.
 *
 * A registration is a claim. Until an administrator has checked it, the person has no session by any route and is
 * invisible in every list; once approved they are an ordinary member; once rejected they are told why and stay out.
 */
import * as email from '../../src/utils/email';
import { http, prisma, uniqueEmail, createUser } from './helpers';

const PASSWORD = 'Alumni#2026';

const spy = <K extends keyof typeof email>(name: K) =>
  jest.spyOn(email, name as any).mockResolvedValue(undefined as never) as unknown as jest.Mock;

afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(() => {
  jest.restoreAllMocks();
});

const register = (address: string, extra: Record<string, unknown> = {}) =>
  http().post('/api/auth/register').send({
    email: address,
    password: PASSWORD,
    fullName: 'Approval Applicant',
    batchYear: 2016,
    department: 'Computer Engineering',
    degree: 'B.E.',
    enrollmentNumber: '16CE099',
    verificationNote: 'Class of 2016, ask Prof. Rao',
    ...extra,
  });

/** The e-mails are events on the notification bus: in-process here (no broker in the tests), right after the response. */
const eventually = async (check: () => void | Promise<void>, ms = 3000) => {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
};

const login = (address: string, password = PASSWORD) => http().post('/api/auth/login').send({ email: address, password });

describe('alumni approval', () => {
  it('a new registration cannot sign in, appears in no list, and is reviewed by an administrator', async () => {
    spy('sendVerificationEmail');
    const welcome = spy('sendWelcomeEmail');
    const address = uniqueEmail('applicant');
    const admin = await createUser('ADMIN');
    const member = await createUser('MEMBER');

    const reg = await register(address);
    expect(reg.status).toBe(201);
    expect(reg.body.data.approvalStatus).toBe('PENDING');
    expect(reg.body.data).not.toHaveProperty('accessToken');

    const stored = await prisma.user.findUnique({ where: { email: address } });
    expect(stored).toMatchObject({ approvalStatus: 'PENDING', isVerified: false, enrollmentNumber: '16CE099' });

    // No session by password
    const denied = await login(address);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ACCOUNT_PENDING_APPROVAL');
    expect(JSON.stringify(denied.body)).not.toMatch(/accessToken|refreshToken/);
    // ...and the status is not given away to somebody who does not know the password
    expect((await login(address, 'Wrong#Pass9')).body.error.code).toBe('INVALID_CREDENTIALS');

    // Invisible to members: not in the directory, no profile page, cannot be messaged
    const directory = await http().get('/api/users/directory').set('Authorization', member.auth).query({ search: 'Approval Applicant' });
    expect(directory.status).toBe(200);
    expect(JSON.stringify(directory.body)).not.toContain(stored!.id);
    expect((await http().get(`/api/users/${stored!.id}`).set('Authorization', member.auth)).status).toBe(404);
    expect((await http().post('/api/messages').set('Authorization', member.auth).send({ receiverId: stored!.id, content: 'hi' })).status).toBe(404);

    // Members cannot use the review queue; the administrator sees the claim and its evidence
    expect((await http().get('/api/admin/approvals').set('Authorization', member.auth)).status).toBe(403);
    const queue = await http().get('/api/admin/approvals').set('Authorization', admin.auth).query({ search: '16CE099' });
    expect(queue.status).toBe(200);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0]).toMatchObject({ id: stored!.id, enrollmentNumber: '16CE099', verificationNote: 'Class of 2016, ask Prof. Rao', approvalStatus: 'PENDING' });
    expect(JSON.stringify(queue.body)).not.toMatch(/passwordHash/);

    // Approval
    const approved = await http().post(`/api/admin/approvals/${stored!.id}/approve`).set('Authorization', admin.auth).send({ note: 'In the 2016 list' });
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ approvalStatus: 'APPROVED', approvalNote: 'In the 2016 list', approvalReviewedBy: { id: admin.user.id } });
    await eventually(() => expect(welcome).toHaveBeenCalledWith(address, 'Approval Applicant'));
    expect(await prisma.user.findUnique({ where: { id: stored!.id }, select: { isVerified: true, approvalReviewedById: true } })).toEqual({ isVerified: true, approvalReviewedById: admin.user.id });
    // Approving twice is refused
    expect((await http().post(`/api/admin/approvals/${stored!.id}/approve`).set('Authorization', admin.auth).send({})).status).toBe(409);

    // Now an ordinary member
    const session = await login(address);
    expect(session.status).toBe(200);
    expect(session.body.data.accessToken).toBeTruthy();
    const me = await http().get('/api/auth/me').set('Authorization', `Bearer ${session.body.data.accessToken}`);
    expect(me.status).toBe(200);
    const listed = await http().get('/api/users/directory').set('Authorization', member.auth).query({ search: 'Approval Applicant' });
    expect(JSON.stringify(listed.body)).toContain(stored!.id);

    // The decision is in the audit log
    const audit = await prisma.auditLog.findFirst({ where: { entityId: stored!.id, action: 'APPROVE' } });
    expect(audit).toMatchObject({ userId: admin.user.id, entityType: 'USER' });
  });

  it('a rejected registration is told why by e-mail, stays out, and can still be approved later', async () => {
    spy('sendVerificationEmail');
    const rejection = spy('sendRejectionEmail');
    spy('sendWelcomeEmail');
    const address = uniqueEmail('rejected');
    const admin = await createUser('ADMIN');
    await register(address);
    const id = (await prisma.user.findUnique({ where: { email: address } }))!.id;

    // The reason is required
    expect((await http().post(`/api/admin/approvals/${id}/reject`).set('Authorization', admin.auth).send({})).status).toBe(400);

    const rejected = await http().post(`/api/admin/approvals/${id}/reject`).set('Authorization', admin.auth).send({ reason: 'We could not find you in the 2016 batch.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({ approvalStatus: 'REJECTED', approvalNote: 'We could not find you in the 2016 batch.' });
    await eventually(() => expect(rejection).toHaveBeenCalledWith(address, 'Approval Applicant', 'We could not find you in the 2016 batch.'));

    const denied = await login(address);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('ACCOUNT_REJECTED');
    // the reason travels by e-mail only; the API answer does not repeat it
    expect(JSON.stringify(denied.body)).not.toContain('2016 batch');

    // A second rejection is refused; the listing under "rejected" shows it
    expect((await http().post(`/api/admin/approvals/${id}/reject`).set('Authorization', admin.auth).send({ reason: 'again' })).status).toBe(409);
    const listing = await http().get('/api/admin/approvals').set('Authorization', admin.auth).query({ status: 'REJECTED', search: address });
    expect(listing.body.data.map((a: { id: string }) => a.id)).toContain(id);

    // An administrator can change their mind
    expect((await http().post(`/api/admin/approvals/${id}/approve`).set('Authorization', admin.auth).send({})).status).toBe(200);
    expect((await login(address)).status).toBe(200);
  });

  it('the college administrator is told that a registration is waiting: by e-mail and in the app, once', async () => {
    spy('sendVerificationEmail');
    const adminMail = spy('sendNewRegistrationEmail');
    const admin = await createUser('ADMIN');
    const address = uniqueEmail('notified');

    const reg = await register(address, { fullName: 'Notify Applicant', department: 'Mechanical Engineering' });
    expect(reg.status).toBe(201);
    const applicantId = (await prisma.user.findUnique({ where: { email: address } }))!.id;

    // (e-mail verification is not required in the tests, so the registration is ready for review at once)
    await eventually(async () => {
      const notice = await prisma.notification.findFirst({
        where: { userId: admin.user.id, type: 'REGISTRATION_PENDING', metadata: { path: ['applicantId'], equals: applicantId } },
      });
      expect(notice).toMatchObject({ link: '/admin/approvals', title: 'New registration to review' });
      expect(notice!.message).toContain('Notify Applicant');
    });
    expect(adminMail).toHaveBeenCalledWith(admin.user.email, { fullName: 'Notify Applicant', batchYear: 2016, department: 'Mechanical Engineering' });

    // the notice is also what the administrator's bell shows
    const bell = await http().get('/api/notifications').set('Authorization', admin.auth);
    expect(bell.status).toBe(200);
    expect(JSON.stringify(bell.body)).toContain('REGISTRATION_PENDING');

    // an applicant who was already decided is never announced again
    await http().post(`/api/admin/approvals/${applicantId}/approve`).set('Authorization', admin.auth).send({}).expect(200);
    const before = adminMail.mock.calls.length;
    const { publishNotificationEvent } = await import('../../src/services/notificationBus');
    await publishNotificationEvent('registration.submitted', { applicantId });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(adminMail.mock.calls.length).toBe(before);
  });

  it('a session that exists when the account stops being approved is refused at once', async () => {
    const member = await createUser('MEMBER');
    expect((await http().get('/api/auth/me').set('Authorization', member.auth)).status).toBe(200);

    await prisma.user.update({ where: { id: member.user.id }, data: { approvalStatus: 'REJECTED', isVerified: false } });

    const res = await http().get('/api/auth/me').set('Authorization', member.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_REJECTED');
    expect((await http().get('/api/news').set('Authorization', member.auth)).status).toBe(403);
  });

  it('the community is closed to visitors: anonymous reads are 401', async () => {
    for (const path of ['/api/events', '/api/news', '/api/gallery/albums', '/api/chapters', '/api/jobs', '/api/videos', '/api/magazine', '/api/requirements', '/api/posts', '/api/search?q=a', '/api/donations/wall', '/api/memberships/tiers']) {
      const res = await http().get(path);
      expect([path, res.status]).toEqual([path, 401]);
    }
    // ...while the landing page still has its two public pieces
    expect((await http().get('/api/users/stats')).status).toBe(200);
    expect((await http().get('/api/landing')).status).toBe(200);
  });

  it('the review queue is oldest first and paged, and only counts what exists', async () => {
    const admin = await createUser('ADMIN');
    const summary = await http().get('/api/admin/approvals/summary').set('Authorization', admin.auth);
    expect(summary.status).toBe(200);
    expect(summary.body.data).toEqual({ pending: expect.any(Number), approved: expect.any(Number), rejected: expect.any(Number) });
    expect(summary.body.data.approved).toBeGreaterThan(0);

    const first = await createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false, fullName: 'Queue Older', createdAt: new Date('2020-01-01') });
    const second = await createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false, fullName: 'Queue Newer', createdAt: new Date('2020-01-02') });
    const page = await http().get('/api/admin/approvals').set('Authorization', admin.auth).query({ search: 'Queue ', limit: 1 });
    expect(page.status).toBe(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0].id).toBe(first.user.id);
    expect(page.body.pagination.total).toBeGreaterThanOrEqual(2);
    expect(second.user.id).toBeTruthy();
  });
});
