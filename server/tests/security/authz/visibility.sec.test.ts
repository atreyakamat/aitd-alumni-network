/**
 * AUTHZ security suite: visibility bypasses.
 *
 * Each test asserts the SECURE behaviour. A failing test here is a confirmed
 * vulnerability; a passing test documents a control that is correctly enforced.
 */
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AUTHZ: post visibility', () => {
  /**
   * CONFIRMED (AZ-03): createPostSchema (src/utils/validators.ts) does not whitelist
   * `visibility`, so POST /api/posts silently drops it and postService.createPost falls
   * back to PUBLIC. A member who asks for a CONNECTIONS-only post gets a fully public one
   * with no error. PATCH /api/posts/:id is NOT schema-validated and does honour `visibility`
   * correctly (see the second test), which is what exposes the gap between create and update.
   */
  it('honours visibility=CONNECTIONS requested at post creation time', async () => {
    const author = await createUser('MEMBER');
    const stranger = await createUser('MEMBER');

    const created = await http()
      .post('/api/posts')
      .set('Authorization', author.auth)
      .send({ content: 'connections-only secret', visibility: 'CONNECTIONS' });
    expect(created.status).toBe(201);
    expect(created.body.data.visibility).toBe('CONNECTIONS'); // currently published as PUBLIC instead

    const id = created.body.data.id;
    const strangerView = await http().get(`/api/posts/${id}`).set('Authorization', stranger.auth);
    expect(strangerView.status).toBe(404);

    const anonView = await http().get(`/api/posts/${id}`);
    expect(anonView.status).toBe(404);

    const feed = await http().get('/api/posts?limit=50').set('Authorization', stranger.auth);
    expect(JSON.stringify(feed.body)).not.toContain(id);
  });

  it('(control) honours visibility=CONNECTIONS applied via PATCH after creation', async () => {
    const author = await createUser('MEMBER');
    const stranger = await createUser('MEMBER');

    const created = await http().post('/api/posts').set('Authorization', author.auth).send({ content: 'plain' });
    const id = created.body.data.id;
    const patched = await http().patch(`/api/posts/${id}`).set('Authorization', author.auth).send({ visibility: 'CONNECTIONS' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.visibility).toBe('CONNECTIONS');

    const strangerView = await http().get(`/api/posts/${id}`).set('Authorization', stranger.auth);
    expect(strangerView.status).toBe(404);
  });

  it('a CONNECTIONS post is not reachable via comments, reactions, view or hashtag listings for a non-connection', async () => {
    const author = await createUser('MEMBER');
    const stranger = await createUser('MEMBER');

    const created = await http().post('/api/posts').set('Authorization', author.auth).send({ content: 'secret #privatehash' });
    const id = created.body.data.id;
    await http().patch(`/api/posts/${id}`).set('Authorization', author.auth).send({ visibility: 'CONNECTIONS' });

    expect((await http().get(`/api/posts/${id}/comments`).set('Authorization', stranger.auth)).status).toBe(404);
    expect((await http().get(`/api/posts/${id}/reactions`).set('Authorization', stranger.auth)).status).toBe(404);
    expect((await http().post(`/api/posts/${id}/view`).set('Authorization', stranger.auth)).status).toBe(404);
    expect((await http().post(`/api/posts/${id}/report`).set('Authorization', stranger.auth).send({ reason: 'SPAM' })).status).toBe(404);

    const hashtagPage = await http().get('/api/hashtags/privatehash/posts').set('Authorization', stranger.auth);
    expect(JSON.stringify(hashtagPage.body)).not.toContain(id);
  });
});

describe('AUTHZ: unverified / deactivated users are excluded from discovery surfaces', () => {
  it('mention-search excludes unverified members', async () => {
    const me = await createUser('MEMBER');
    const unverified = await createUser('MEMBER', { fullName: 'Zzz Unverified Probe', isVerified: false });

    const res = await http().get(`/api/users/mention-search?q=${encodeURIComponent('Zzz Unverified')}`).set('Authorization', me.auth);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(unverified.user.id);
  });

  it('connection suggestions exclude unverified and deactivated members', async () => {
    const me = await createUser('MEMBER', { batchYear: 2017, department: 'Robotics', city: 'Nagpur' });
    const unverified = await createUser('MEMBER', { batchYear: 2017, department: 'Robotics', city: 'Nagpur', isVerified: false });
    const deactivated = await createUser('MEMBER', { batchYear: 2017, department: 'Robotics', city: 'Nagpur', isActive: false });

    const res = await http().get('/api/network/suggestions?limit=50').set('Authorization', me.auth);
    expect(res.status).toBe(200);
    const ids = res.body.data.map((u: any) => u.id);
    expect(ids).not.toContain(unverified.user.id);
    expect(ids).not.toContain(deactivated.user.id);
  });

  it('a deactivated author\'s posts disappear from the public feed and direct fetch', async () => {
    const author = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const post = await http().post('/api/posts').set('Authorization', author.auth).send({ content: 'before deactivation' });
    const id = post.body.data.id;

    await prisma.user.update({ where: { id: author.user.id }, data: { isActive: false } });

    expect((await http().get(`/api/posts/${id}`).set('Authorization', other.auth)).status).toBe(404);
    const feed = await http().get('/api/posts?limit=50').set('Authorization', other.auth);
    expect(JSON.stringify(feed.body)).not.toContain(id);
  });
});
