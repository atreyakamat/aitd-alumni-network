/**
 * Notification settings on a real PostgreSQL: a member's choices are their own and only theirs, an opt-out is honoured, the
 * notices that must always arrive ignore every setting, and the rows are part of the member's export and are erased with the account.
 */
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';
import { notificationService } from '../../../src/services/notificationService';

afterAll(async () => {
  await prisma.$disconnect();
});

const CATEGORIES = ['CONNECTIONS', 'MESSAGES', 'POSTS_AND_COMMENTS', 'EVENTS', 'JOBS_AND_MENTORSHIP', 'ANNOUNCEMENTS'];
const get = (auth: string) => http().get('/api/notifications/preferences').set('Authorization', auth);
const put = (auth: string, body: unknown) => http().put('/api/notifications/preferences').set('Authorization', auth).send(body as object);
const count = (userId: string, type: string) => prisma.notification.count({ where: { userId, type: type as never } });

describe('the settings are per member', () => {
  it('everything is on for a member who never changed anything, and nothing is stored', async () => {
    const me = await createUser('MEMBER');
    const res = await get(me.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.preferences.map((p: { category: string }) => p.category)).toEqual(CATEGORIES);
    expect(res.body.data.preferences.every((p: { inApp: boolean; email: boolean }) => p.inApp && p.email)).toBe(true);
    expect(await prisma.notificationPreference.count({ where: { userId: me.user.id } })).toBe(0);
  });

  it('a change is saved for the caller only, partially, and repeating it keeps one row', async () => {
    const me = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    expect((await put(me.auth, { preferences: [{ category: 'MESSAGES', inApp: false }] })).status).toBe(200);
    const again = await put(me.auth, { preferences: [{ category: 'MESSAGES', email: false }] });
    expect(again.body.data.preferences.find((p: { category: string }) => p.category === 'MESSAGES')).toEqual({ category: 'MESSAGES', inApp: false, email: false });
    expect(await prisma.notificationPreference.count({ where: { userId: me.user.id } })).toBe(1);
    expect(await prisma.notificationPreference.count({ where: { userId: other.user.id } })).toBe(0);
    expect((await get(other.auth)).body.data.preferences.every((p: { inApp: boolean; email: boolean }) => p.inApp && p.email)).toBe(true);
  });

  it('cannot be pointed at somebody else: a user id in the body is refused and nothing is written', async () => {
    const me = await createUser('MEMBER');
    const victim = await createUser('MEMBER');
    const res = await put(me.auth, { preferences: [{ category: 'MESSAGES', inApp: false, userId: victim.user.id }] });
    expect(res.status).toBe(400);
    const res2 = await put(me.auth, { userId: victim.user.id, preferences: [{ category: 'MESSAGES', inApp: false }] });
    expect(res2.status).toBe(400);
    expect(await prisma.notificationPreference.count({ where: { userId: { in: [me.user.id, victim.user.id] } } })).toBe(0);
  });

  it('refuses unknown categories (the always-on notices have none), bad types, duplicates and oversized lists', async () => {
    const me = await createUser('MEMBER');
    for (const body of [
      { preferences: [{ category: 'REGISTRATION_PENDING', inApp: false }] },
      { preferences: [{ category: 'ACCOUNT_AND_SECURITY', email: false }] },
      { preferences: [{ category: "MESSAGES'; DROP TABLE \"User\";--", inApp: false }] },
      { preferences: [{ category: 'MESSAGES', inApp: 'no' }] },
      { preferences: [{ category: 'MESSAGES', inApp: false }, { category: 'MESSAGES', inApp: true }] },
      { preferences: Array.from({ length: 500 }, () => ({ category: 'MESSAGES', inApp: false })) },
      { preferences: [] },
      {},
    ]) {
      expect((await put(me.auth, body)).status).toBe(400);
    }
    expect(await prisma.notificationPreference.count({ where: { userId: me.user.id } })).toBe(0);
  });

  it('needs a signed-in member', async () => {
    expect((await http().get('/api/notifications/preferences')).status).toBe(401);
    expect((await http().put('/api/notifications/preferences').send({ preferences: [{ category: 'MESSAGES', inApp: false }] })).status).toBe(401);
  });
});

describe('an opt-out is honoured, and a notice that must arrive always does', () => {
  it('a member who switched the bell off for connections gets no NEW_FOLLOWER; switching it on again brings it back', async () => {
    const actor = await createUser('MEMBER');
    const actor2 = await createUser('MEMBER');
    const target = await createUser('MEMBER');
    await put(target.auth, { preferences: [{ category: 'CONNECTIONS', inApp: false }] });

    expect((await http().post(`/api/users/${target.user.id}/follow`).set('Authorization', actor.auth)).status).toBeLessThan(300);
    expect(await count(target.user.id, 'NEW_FOLLOWER')).toBe(0); // the follow itself still worked

    await put(target.auth, { preferences: [{ category: 'CONNECTIONS', inApp: true }] });
    await http().post(`/api/users/${target.user.id}/follow`).set('Authorization', actor2.auth);
    expect(await count(target.user.id, 'NEW_FOLLOWER')).toBe(1);
  });

  it('with every category switched off the member still gets the notices that always arrive', async () => {
    const admin = await createUser('ADMIN');
    await put(admin.auth, { preferences: CATEGORIES.map((category) => ({ category, inApp: false, email: false })) });

    for (const type of ['REGISTRATION_PENDING', 'MEMBERSHIP_EXPIRY', 'CONTENT_REPORTED'] as const) {
      await notificationService.createNotification({ userId: admin.user.id, type, title: 'Must arrive', message: 'x' });
      expect(await count(admin.user.id, type)).toBe(1);
    }
    await notificationService.createNotification({ userId: admin.user.id, type: 'POST_LIKED', title: 'Optional', message: 'x' });
    expect(await count(admin.user.id, 'POST_LIKED')).toBe(0);
    await notificationService.createNotification({ userId: admin.user.id, type: 'ADMIN_ANNOUNCEMENT', title: 'Urgent', message: 'x', essential: true });
    expect(await count(admin.user.id, 'ADMIN_ANNOUNCEMENT')).toBe(1);
  });

  it('a broadcast skips only the members who switched announcements off', async () => {
    const quiet = await createUser('MEMBER');
    const normal = await createUser('MEMBER');
    await put(quiet.auth, { preferences: [{ category: 'ANNOUNCEMENTS', inApp: false }] });
    const { fanOutNotification } = await import('../../../src/services/broadcastService');
    await fanOutNotification({ type: 'ADMIN_ANNOUNCEMENT', title: 'Reunion r3 prefs', message: 'Join us' });
    expect(await count(quiet.user.id, 'ADMIN_ANNOUNCEMENT')).toBe(0);
    expect(await count(normal.user.id, 'ADMIN_ANNOUNCEMENT')).toBe(1);
  });
});

describe('the rows belong to the member', () => {
  it('are in their own export and in nobody else\'s', async () => {
    const me = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    await put(me.auth, { preferences: [{ category: 'EVENTS', inApp: false }] });
    await put(other.auth, { preferences: [{ category: 'JOBS_AND_MENTORSHIP', email: false }] });
    const res = await http().get('/api/users/me/export').set('Authorization', me.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.notificationPreferences).toEqual([expect.objectContaining({ category: 'EVENTS', inApp: false, email: true })]);
    expect(JSON.stringify(res.body)).not.toContain('JOBS_AND_MENTORSHIP');
  });

  it('are erased when the account is deleted', async () => {
    const me = await createUser('MEMBER');
    await put(me.auth, { preferences: [{ category: 'EVENTS', inApp: false }] });
    const login = await http().post('/api/auth/login').send({ email: me.user.email, password: PASSWORD });
    const del = await http().delete('/api/users/me').set('Authorization', `Bearer ${login.body.data.accessToken}`).send({ password: PASSWORD });
    expect(del.status).toBe(200);
    expect(await prisma.notificationPreference.count({ where: { userId: me.user.id } })).toBe(0);
  });
});
