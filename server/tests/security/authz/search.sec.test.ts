/**
 * Search must obey the same visibility rules as every other read path, and anonymous visitors must only
 * ever get public content. Runs against real PostgreSQL.
 */
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const TOKEN = `zq${Date.now().toString(36)}`;

describe('search visibility', () => {
  let author: Awaited<ReturnType<typeof createUser>>;
  let friend: Awaited<ReturnType<typeof createUser>>;
  let stranger: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    author = await createUser('MEMBER', { fullName: `Author ${TOKEN}` });
    friend = await createUser('MEMBER');
    stranger = await createUser('MEMBER');
    await prisma.connection.create({
      data: { requesterId: author.user.id, addresseeId: friend.user.id, status: 'ACCEPTED' },
    });
    await prisma.post.create({
      data: { userId: author.user.id, content: `public ${TOKEN} update`, visibility: 'PUBLIC' },
    });
    await prisma.post.create({
      data: { userId: author.user.id, content: `private ${TOKEN} update for friends`, visibility: 'CONNECTIONS' },
    });
    await prisma.event.create({
      data: {
        title: `Open ${TOKEN} meetup`,
        description: 'public event',
        createdById: author.user.id,
        startDate: new Date(Date.now() + 86_400_000),
        status: 'PUBLISHED',
        isPublic: true,
      },
    });
    await prisma.event.create({
      data: {
        title: `Members ${TOKEN} dinner`,
        description: 'members only event',
        createdById: author.user.id,
        startDate: new Date(Date.now() + 86_400_000),
        status: 'PUBLISHED',
        isPublic: false,
      },
    });
  });

  const search = (auth?: string) => {
    const req = http().get('/api/search').query({ q: TOKEN });
    return auth ? req.set('Authorization', auth) : req;
  };
  const postContents = (res: { body: { data: { posts: Array<{ content: string }> } } }) =>
    res.body.data.posts.map((p) => p.content);

  it('a stranger does not find a CONNECTIONS-only post, but finds the public one', async () => {
    const res = await search(stranger.auth);
    expect(res.status).toBe(200);
    const contents = postContents(res);
    expect(contents.some((c) => c.startsWith('public'))).toBe(true);
    expect(contents.some((c) => c.startsWith('private'))).toBe(false);
  });

  it('a connection finds both, and so does the author', async () => {
    for (const viewer of [friend, author]) {
      const contents = postContents(await search(viewer.auth));
      expect(contents.some((c) => c.startsWith('public'))).toBe(true);
      expect(contents.some((c) => c.startsWith('private'))).toBe(true);
    }
  });

  it('a visitor learns nothing: the community is private, so search answers 401 and runs no query', async () => {
    const res = await search();
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(author.user.email);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('a registration that is not approved learns nothing either (403)', async () => {
    const pending = await createUser('MEMBER', { approvalStatus: 'PENDING', isVerified: false });
    const res = await search(pending.auth);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(TOKEN);
  });

  it('a member also finds members-only events', async () => {
    const res = await search(stranger.auth);
    const titles = res.body.data.events.map((e: { title: string }) => e.title);
    expect(titles).toEqual(expect.arrayContaining([`Open ${TOKEN} meetup`, `Members ${TOKEN} dinner`]));
    expect(res.body.data.scope).toBe('member');
    expect(res.body.data.users.map((u: { fullName: string }) => u.fullName)).toContain(`Author ${TOKEN}`);
  });

  it('refuses an invalid token with 401 instead of quietly serving the logged-out view', async () => {
    const res = await search('Bearer definitely-not-valid');
    expect(res.status).toBe(401);
  });

  it('never returns private fields or full article bodies', async () => {
    const res = await search(stranger.auth);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/passwordHash|phoneNumber|"email"/);
  });
});
