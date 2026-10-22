/**
 * End-to-end RBAC & governance flows against a real PostgreSQL database.
 */
import { execSync } from 'child_process';
import path from 'path';
import { createUser, http, prisma } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('database & platform', () => {
  it('has migrations that exactly match schema.prisma (no drift)', () => {
    const serverRoot = path.resolve(__dirname, '../..');
    // --exit-code: 0 = no difference, 2 = difference
    expect(() =>
      execSync(
        `npx prisma migrate diff --from-url "${process.env.DATABASE_URL}" --to-schema-datamodel prisma/schema.prisma --exit-code`,
        { cwd: serverRoot, stdio: 'pipe' }
      )
    ).not.toThrow();
  });

  it('reports a healthy database', async () => {
    const res = await http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', databaseStatus: 'up' });
  });
});

describe('admin user management', () => {
  it('lets a super admin promote, and an admin is then bounded by the hierarchy', async () => {
    const superAdmin = await createUser('SUPER_ADMIN');
    const member = await createUser('MEMBER');
    const other = await createUser('MEMBER');

    // Member cannot reach admin APIs
    expect((await http().get('/api/admin/users').set('Authorization', member.auth)).status).toBe(403);

    // Super admin promotes member -> ADMIN
    const promote = await http()
      .patch(`/api/admin/users/${member.user.id}/role`)
      .set('Authorization', superAdmin.auth)
      .send({ role: 'ADMIN' });
    expect(promote.status).toBe(200);
    expect(promote.body.data.userRole).toBe('ADMIN');

    // The promotion takes effect immediately with the *same* token (role read from DB)
    const list = await http().get('/api/admin/users?limit=5').set('Authorization', member.auth);
    expect(list.status).toBe(200);
    expect(list.body.pagination.limit).toBe(5);
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash/);

    // New admin can appoint a chapter admin but not another admin
    const toChapterAdmin = await http()
      .patch(`/api/admin/users/${other.user.id}/role`)
      .set('Authorization', member.auth)
      .send({ role: 'CHAPTER_ADMIN' });
    expect(toChapterAdmin.status).toBe(200);

    const toAdmin = await http()
      .patch(`/api/admin/users/${other.user.id}/role`)
      .set('Authorization', member.auth)
      .send({ role: 'ADMIN' });
    expect(toAdmin.status).toBe(403);

    // Admin cannot touch the super admin
    const demoteSuper = await http()
      .patch(`/api/admin/users/${superAdmin.user.id}/status`)
      .set('Authorization', member.auth)
      .send({ isActive: false });
    expect(demoteSuper.status).toBe(403);

    // Every role change is audited
    const audits = await prisma.auditLog.findMany({ where: { action: 'ROLE_CHANGE', entityId: { in: [member.user.id, other.user.id] } } });
    expect(audits).toHaveLength(2);
  });

  it('deactivation locks the user out immediately and revokes refresh tokens', async () => {
    const admin = await createUser('ADMIN');
    const member = await createUser('MEMBER');
    await prisma.refreshToken.create({
      data: { token: `rt-${member.user.id}`, userId: member.user.id, expiresAt: new Date(Date.now() + 86400000) },
    });

    expect((await http().get('/api/auth/me').set('Authorization', member.auth)).status).toBe(200);

    const res = await http()
      .patch(`/api/admin/users/${member.user.id}/status`)
      .set('Authorization', admin.auth)
      .send({ isActive: false, reason: 'spam' });
    expect(res.status).toBe(200);

    expect((await http().get('/api/auth/me').set('Authorization', member.auth)).status).toBe(401);
    expect(await prisma.refreshToken.count({ where: { userId: member.user.id } })).toBe(0);
  });

  it('exports CSV with formula injection neutralised', async () => {
    const admin = await createUser('ADMIN');
    await createUser('MEMBER', { fullName: '=HYPERLINK("http://evil")' });

    const res = await http().get('/api/admin/export/users').set('Authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="users-/);
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(res.text).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
});

describe('chapter admin scope', () => {
  it('a chapter admin manages only their own chapter and its events', async () => {
    const admin = await createUser('ADMIN');
    const candidate = await createUser('MEMBER');
    const outsider = await createUser('CHAPTER_ADMIN');

    const mine = await prisma.chapter.create({ data: { name: `Pune ${Date.now()}`, region: 'West' } });
    const theirs = await prisma.chapter.create({ data: { name: `Delhi ${Date.now()}`, region: 'North' } });

    // Admin assigns candidate -> becomes CHAPTER_ADMIN automatically
    const assign = await http()
      .put(`/api/chapters/${mine.id}/admin`)
      .set('Authorization', admin.auth)
      .send({ userId: candidate.user.id });
    expect(assign.status).toBe(200);
    expect((await prisma.user.findUnique({ where: { id: candidate.user.id } }))!.userRole).toBe('CHAPTER_ADMIN');

    // Own chapter: allowed; mass-assignment of counters is ignored
    const edit = await http()
      .patch(`/api/chapters/${mine.id}`)
      .set('Authorization', candidate.auth)
      .send({ description: 'Pune alumni', memberCount: 99999 });
    expect(edit.status).toBe(200);
    expect(edit.body.data.description).toBe('Pune alumni');
    expect(edit.body.data.memberCount).toBe(0);

    // Other chapter: forbidden
    const foreign = await http().patch(`/api/chapters/${theirs.id}`).set('Authorization', outsider.auth).send({ description: 'x' });
    expect(foreign.status).toBe(403);

    const eventBody = {
      title: 'Chapter Meetup',
      description: 'An evening with Pune alumni',
      startDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    };

    const ownEvent = await http()
      .post('/api/events')
      .set('Authorization', candidate.auth)
      .send({ ...eventBody, chapterId: mine.id });
    expect(ownEvent.status).toBe(201);

    const otherEvent = await http()
      .post('/api/events')
      .set('Authorization', candidate.auth)
      .send({ ...eventBody, chapterId: theirs.id });
    expect(otherEvent.status).toBe(403);

    const member = await createUser('MEMBER');
    expect((await http().post('/api/events').set('Authorization', member.auth).send(eventBody)).status).toBe(403);
  });
});

describe('privacy controls', () => {
  it('exports own data and deletes the account (anonymised, cannot log in)', async () => {
    const member = await createUser('MEMBER', { phoneNumber: '+91-9999999999', city: 'Pune' });

    const exported = await http().get('/api/users/me/export').set('Authorization', member.auth);
    expect(exported.status).toBe(200);
    expect(exported.body.data.profile.email).toBe(member.user.email);
    expect(JSON.stringify(exported.body)).not.toMatch(/passwordHash/);

    const wrong = await http().delete('/api/users/me').set('Authorization', member.auth).send({ password: 'nope' });
    expect(wrong.status).toBe(401);

    const del = await http().delete('/api/users/me').set('Authorization', member.auth).send({ password: 'Str0ng!Passw0rd' });
    expect(del.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: member.user.id } });
    expect(after).toMatchObject({ fullName: 'Deleted User', isActive: false, phoneNumber: null, city: null, passwordHash: null });
    expect((await http().get('/api/auth/me').set('Authorization', member.auth)).status).toBe(401);

    const login = await http().post('/api/auth/login').send({ email: member.user.email, password: 'Str0ng!Passw0rd' });
    expect(login.status).toBeGreaterThanOrEqual(400);
  });
});
