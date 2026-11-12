/**
 * ROUND 3 / B - mass assignment on every route that takes a user body, and on the admin routes.
 *
 * The forbidden fields (approvalStatus, userRole, isVerified, isActive, tokenVersion, passwordHash, emailVerifiedAt, the reviewer's
 * fields, ownership ids) are sent in bodies of every shape; afterwards the ROW must be exactly what it was, whatever the response.
 */
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const FORBIDDEN = {
  approvalStatus: 'APPROVED',
  approvalNote: 'self approved',
  approvalReviewedAt: new Date().toISOString(),
  approvalReviewedById: '00000000-0000-4000-8000-000000000001',
  userRole: 'SUPER_ADMIN',
  role: 'SUPER_ADMIN',
  isVerified: true,
  isActive: false,
  tokenVersion: 99,
  passwordHash: '$2a$12$abcdefghijklmnopqrstuuMwBsB1EqVYtB4A5nG8aqsV4G1tYzYuK',
  password: 'Changed!Passw0rd-1',
  emailVerifiedAt: new Date().toISOString(),
  email: 'hijacked@aiem.test',
  twoFactorEnabled: true,
  membershipTierId: '00000000-0000-4000-8000-000000000002',
  enrollmentNumber: 'FORGED-1',
  verificationNote: 'forged',
  profileCompleteness: 100,
  lastLoginAt: new Date().toISOString(),
  id: '00000000-0000-4000-8000-000000000003',
  userId: '00000000-0000-4000-8000-000000000004',
  createdAt: '2001-01-01T00:00:00.000Z',
  chapterId: '00000000-0000-4000-8000-000000000005',
  isFeatured: true,
  isPublic: true,
  ['__proto__']: { userRole: 'SUPER_ADMIN' },
  constructor: { prototype: { userRole: 'SUPER_ADMIN' } },
};

const snapshot = async (id: string) => {
  const row = await prisma.user.findUniqueOrThrow({ where: { id } });
  return JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? String(v) : v)));
};
const withoutVolatile = (row: Record<string, unknown>) => {
  const { updatedAt: _u, profileCompleteness: _p, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

describe('a member cannot reach privileged columns through any self-service body', () => {
  it('PATCH /users/profile', async () => {
    const { user, auth } = await createUser('MEMBER');
    const before = withoutVolatile(await snapshot(user.id));
    const res = await http().patch('/api/users/profile').set('Authorization', auth).send({ ...FORBIDDEN, shortBio: 'only this should change' });
    expect(res.status).toBeLessThan(500);
    const after = withoutVolatile(await snapshot(user.id));
    expect({ ...after, shortBio: before.shortBio }).toEqual(before);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).shortBio).toBe(res.status < 300 ? 'only this should change' : before.shortBio);
    expect(Object.prototype.hasOwnProperty.call(({} as Record<string, unknown>), 'userRole')).toBe(false);
  });

  it('PATCH /users/profile with only forbidden fields changes nothing and is refused or ignored (never a 500)', async () => {
    const { user, auth } = await createUser('MEMBER');
    const before = withoutVolatile(await snapshot(user.id));
    const res = await http().patch('/api/users/profile').set('Authorization', auth).send(FORBIDDEN);
    expect(res.status).toBeLessThan(500);
    expect(withoutVolatile(await snapshot(user.id))).toEqual(before);
  });

  it('work experience, education and skills: the body cannot name another owner and the id in the URL decides', async () => {
    const me = await createUser('MEMBER');
    const victim = await createUser('MEMBER');
    const created = await http().post('/api/users/work-experience').set('Authorization', me.auth).send({ ...FORBIDDEN, company: 'Acme', role: 'Dev', startDate: '2020-01-01' });
    expect(created.status).toBeLessThan(300);
    expect(await prisma.workExperience.count({ where: { userId: me.user.id } })).toBe(1);
    expect(await prisma.workExperience.count({ where: { userId: FORBIDDEN.userId } })).toBe(0);

    const edu = await http().post('/api/users/education').set('Authorization', me.auth).send({ ...FORBIDDEN, institution: 'AIEM', degree: 'B.E.', startYear: 2010 });
    expect(edu.status).toBeLessThan(300);
    expect(await prisma.education.count({ where: { userId: me.user.id } })).toBe(1);

    // someone else's row cannot be edited, and moving my own row to somebody else is ignored
    const theirs = await prisma.workExperience.create({ data: { userId: victim.user.id, company: 'Theirs', role: 'X', startDate: new Date('2019-01-01') } });
    const steal = await http().patch(`/api/users/work-experience/${theirs.id}`).set('Authorization', me.auth).send({ company: 'Mine now' });
    expect(steal.status).toBe(404);
    const move = await http().patch(`/api/users/work-experience/${created.body.data.id}`).set('Authorization', me.auth).send({ userId: victim.user.id, company: 'Acme 2' });
    expect(move.status).toBeLessThan(500);
    expect((await prisma.workExperience.findUniqueOrThrow({ where: { id: created.body.data.id } })).userId).toBe(me.user.id);
    expect((await prisma.workExperience.findUniqueOrThrow({ where: { id: theirs.id } })).company).toBe('Theirs');

    const skills = await http().put('/api/users/skills').set('Authorization', me.auth).send({ ...FORBIDDEN, skills: ['Go'] });
    expect(skills.status).toBeLessThan(500);
    expect(await snapshot(me.user.id)).toMatchObject({ userRole: 'MEMBER', approvalStatus: 'APPROVED', tokenVersion: me.user.tokenVersion });
  });

  it('change password / 2FA / delete-account bodies cannot carry flags either', async () => {
    const { user, auth } = await createUser('MEMBER');
    const res = await http().post('/api/auth/change-password').set('Authorization', auth).send({ ...FORBIDDEN, currentPassword: PASSWORD, newPassword: 'Another!Passw0rd-77' });
    expect(res.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ userRole: 'MEMBER', isActive: true, approvalStatus: 'APPROVED', twoFactorEnabled: false });
    expect(row.email).toBe(user.email);
    expect(row.passwordHash).not.toBe(FORBIDDEN.passwordHash);
    expect(row.tokenVersion).toBe(user.tokenVersion + 1); // bumped by the change, not set to 99
  });
});

describe('admin routes: the body names what to change, nothing else', () => {
  it('PATCH /admin/users/:id/status only flips isActive (reason is audit text)', async () => {
    const admin = await createUser('ADMIN');
    const target = await createUser('MEMBER');
    const before = withoutVolatile(await snapshot(target.user.id));
    const res = await http().patch(`/api/admin/users/${target.user.id}/status`).set('Authorization', admin.auth).send({ ...FORBIDDEN, isActive: false, reason: 'test' });
    expect(res.status).toBe(200);
    const after = withoutVolatile(await snapshot(target.user.id));
    expect(after).toMatchObject({ isActive: false, userRole: 'MEMBER', approvalStatus: 'APPROVED', email: before.email, passwordHash: before.passwordHash });
    expect(after.tokenVersion).toBe((before.tokenVersion as number) + 1);
  });

  it('PATCH /admin/users/:id/role changes the role and nothing else; an ADMIN cannot make a SUPER_ADMIN, nor touch one', async () => {
    const admin = await createUser('ADMIN');
    const superAdmin = await createUser('SUPER_ADMIN');
    const target = await createUser('MEMBER');

    const ok = await http().patch(`/api/admin/users/${target.user.id}/role`).set('Authorization', admin.auth).send({ ...FORBIDDEN, role: 'CHAPTER_ADMIN' });
    expect(ok.status).toBe(200);
    expect(await snapshot(target.user.id)).toMatchObject({ userRole: 'CHAPTER_ADMIN', approvalStatus: 'APPROVED', isActive: true, email: target.user.email });

    for (const role of ['SUPER_ADMIN', 'ADMIN']) {
      const up = await http().patch(`/api/admin/users/${target.user.id}/role`).set('Authorization', admin.auth).send({ role });
      expect({ role, status: up.status }).toEqual({ role, status: 403 });
    }
    const demote = await http().patch(`/api/admin/users/${superAdmin.user.id}/role`).set('Authorization', admin.auth).send({ role: 'MEMBER' });
    expect(demote.status).toBe(403);
    const deactivate = await http().patch(`/api/admin/users/${superAdmin.user.id}/status`).set('Authorization', admin.auth).send({ isActive: false });
    expect(deactivate.status).toBe(403);
    const self = await http().patch(`/api/admin/users/${admin.user.id}/role`).set('Authorization', admin.auth).send({ role: 'SUPER_ADMIN' });
    expect(self.status).toBe(403);
    expect((await snapshot(superAdmin.user.id)).userRole).toBe('SUPER_ADMIN');
    expect((await snapshot(admin.user.id)).userRole).toBe('ADMIN');
  });

  it('approve / reject take a note or a reason and ignore every other field; the decision comes from the URL', async () => {
    const admin = await createUser('ADMIN');
    const applicant = await createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false, emailVerifiedAt: new Date() });
    const rejected = await http()
      .post(`/api/admin/approvals/${applicant.user.id}/reject`)
      .set('Authorization', admin.auth)
      .send({ ...FORBIDDEN, reason: 'cannot confirm this person studied here' });
    expect(rejected.status).toBe(200);
    expect(await snapshot(applicant.user.id)).toMatchObject({ approvalStatus: 'REJECTED', userRole: 'MEMBER', isVerified: false, approvalReviewedById: admin.user.id, isActive: true });

    const approved = await http().post(`/api/admin/approvals/${applicant.user.id}/approve`).set('Authorization', admin.auth).send({ ...FORBIDDEN, note: 'verified with the alumni office' });
    expect(approved.status).toBe(200);
    expect(await snapshot(applicant.user.id)).toMatchObject({
      approvalStatus: 'APPROVED',
      userRole: 'MEMBER',
      approvalReviewedById: admin.user.id,
      approvalNote: 'verified with the alumni office',
      tokenVersion: applicant.user.tokenVersion,
    });
  });

  it('a member (and a chapter admin) cannot reach any of these routes at all', async () => {
    const member = await createUser('MEMBER');
    const chapterAdmin = await createUser('CHAPTER_ADMIN');
    const target = await createUser('MEMBER');
    for (const who of [member, chapterAdmin]) {
      const calls = [
        http().patch(`/api/admin/users/${target.user.id}/role`).set('Authorization', who.auth).send({ role: 'ADMIN' }),
        http().patch(`/api/admin/users/${target.user.id}/status`).set('Authorization', who.auth).send({ isActive: false }),
        http().post(`/api/admin/approvals/${target.user.id}/approve`).set('Authorization', who.auth).send({}),
        http().post(`/api/admin/approvals/${target.user.id}/reject`).set('Authorization', who.auth).send({ reason: 'no reason at all' }),
      ];
      for (const res of await Promise.all(calls)) expect(res.status).toBe(403);
    }
    expect(await snapshot(target.user.id)).toMatchObject({ userRole: 'MEMBER', isActive: true });
  });
});

describe('content bodies cannot reassign ownership or privileged flags', () => {
  it('post, comment and job bodies keep the author the caller and the flags at their defaults', async () => {
    const me = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const post = await http().post('/api/posts').set('Authorization', me.auth).send({ content: 'mine', userId: other.user.id, isPinned: true, likeCount: 500, isPublished: false, visibility: 'PUBLIC' });
    expect(post.status).toBe(201);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: post.body.data.id } })).toMatchObject({ userId: me.user.id, isPinned: false, likeCount: 0 });

    const comment = await http().post(`/api/posts/${post.body.data.id}/comments`).set('Authorization', me.auth).send({ content: 'c', userId: other.user.id, likeCount: 99 });
    expect(comment.status).toBe(201);
    expect(await prisma.postComment.findUniqueOrThrow({ where: { id: comment.body.data.id } })).toMatchObject({ userId: me.user.id, likeCount: 0 });

    const job = await http().post('/api/jobs').set('Authorization', me.auth).send({ title: 'Dev', company: 'Acme', description: 'desc', postedById: other.user.id, status: 'APPROVED', isFeatured: true });
    expect(job.status).toBeLessThan(500);
    if (job.status === 201) {
      const row = await prisma.jobOpportunity.findUniqueOrThrow({ where: { id: job.body.data.id } });
      expect(row).toMatchObject({ postedById: me.user.id, isFeatured: false });
      expect(row.status).not.toBe('APPROVED');
    }
  });
});
