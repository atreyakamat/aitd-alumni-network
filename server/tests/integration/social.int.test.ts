/**
 * The social layer (docs/SOCIAL_API.md) against a real PostgreSQL database: reactions, threaded
 * comments, reposts, visibility, follows, ranking, hashtags, saves, views, reports and video upload.
 */
import { createUser, http, prisma } from './helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

type U = Awaited<ReturnType<typeof createUser>>;

const post = async (u: U, body: Record<string, unknown>) => {
  const res = await http().post('/api/posts').set('Authorization', u.auth).send(body);
  expect(res.status).toBe(201);
  return res.body.data;
};

const connect = (a: U, b: U) =>
  prisma.connection.create({ data: { requesterId: a.user.id, addresseeId: b.user.id, status: 'ACCEPTED' } });

describe('reactions', () => {
  it('adds, changes and removes a reaction, keeping the summary and counter in step', async () => {
    const author = await createUser('MEMBER');
    const fan = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const p = await post(author, { content: 'Reaction test' });
    const react = (u: U, type: string) => http().post(`/api/posts/${p.id}/react`).set('Authorization', u.auth).send({ type });

    expect((await react(fan, 'CELEBRATE')).body.data).toMatchObject({ reaction: 'CELEBRATE', counts: { reactions: 1 } });
    const both = await react(other, 'LIKE');
    expect(both.body.data).toMatchObject({ counts: { reactions: 2 }, reactionSummary: { CELEBRATE: 1, LIKE: 1 } });

    expect((await react(fan, 'LOVE')).body.data).toMatchObject({ reaction: 'LOVE', reactionSummary: { LOVE: 1, LIKE: 1 } });
    expect((await react(fan, 'LOVE')).body.data).toMatchObject({ reaction: null, counts: { reactions: 1 } });

    const stored = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored.likeCount).toBe(1);

    // One notification for the first new reaction per member, none for changes/removals
    const notes = await prisma.notification.findMany({ where: { userId: author.user.id, type: 'POST_REACTED' } });
    expect(notes).toHaveLength(2);
  });
});

describe('threaded comments', () => {
  it('flattens replies to one level and notifies each person once', async () => {
    const author = await createUser('MEMBER');
    const a = await createUser('MEMBER');
    const b = await createUser('MEMBER');
    const p = await post(author, { content: 'Comment test' });

    const top = await http().post(`/api/posts/${p.id}/comments`).set('Authorization', a.auth).send({ content: 'first' });
    expect(top.status).toBe(201);
    // b replies to a's comment and mentions the post author: author gets POST_COMMENTED… or MENTION, never both
    const reply = await http()
      .post(`/api/posts/${p.id}/comments`)
      .set('Authorization', b.auth)
      .send({ content: 'reply', parentId: top.body.data.id, mentionIds: [author.user.id] });
    // a replies to b's reply: it attaches to the top-level comment
    const nested = await http()
      .post(`/api/posts/${p.id}/comments`)
      .set('Authorization', a.auth)
      .send({ content: 'nested', parentId: reply.body.data.id });
    expect(nested.body.data.parentId).toBe(top.body.data.id);

    const forAuthor = await prisma.notification.findMany({
      where: { userId: author.user.id, metadata: { path: ['commentId'], equals: reply.body.data.id } },
    });
    expect(forAuthor).toHaveLength(1);
    const forA = await prisma.notification.findMany({ where: { userId: a.user.id, type: 'COMMENT_REPLIED' } });
    expect(forA).toHaveLength(1);

    const list = await http().get(`/api/posts/${p.id}/comments?sort=newest`);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0]).toMatchObject({ replyCount: 2, previewReplies: [{ content: 'reply' }, { content: 'nested' }] });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).commentCount).toBe(3);
  });
});

describe('reposts', () => {
  it('plain repost once (409 after), quote posts freely, and deleting the original', async () => {
    const author = await createUser('MEMBER');
    const fan = await createUser('MEMBER');
    const p = await post(author, { content: 'Repost me #reposts' });

    const plain = await http().post(`/api/posts/${p.id}/repost`).set('Authorization', fan.auth);
    expect(plain.status).toBe(201);
    expect(plain.body.data).toMatchObject({ isRepost: true, content: '', repostOf: { id: p.id } });
    expect((await http().post(`/api/posts/${p.id}/repost`).set('Authorization', fan.auth)).status).toBe(409);
    // Reposting the repost targets the original, so it is still a duplicate
    expect((await http().post(`/api/posts/${plain.body.data.id}/repost`).set('Authorization', fan.auth)).status).toBe(409);

    const quote = await http().post(`/api/posts/${p.id}/repost`).set('Authorization', fan.auth).send({ content: 'So true' });
    expect(quote.status).toBe(201);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).repostCount).toBe(2);

    const viewed = await http().get(`/api/posts/${p.id}`).set('Authorization', fan.auth);
    expect(viewed.body.data.viewer.reposted).toBe(true);

    await http().delete(`/api/posts/${p.id}`).set('Authorization', author.auth).expect(200);
    expect(await prisma.post.findUnique({ where: { id: plain.body.data.id } })).toBeNull();
    const orphan = await http().get(`/api/posts/${quote.body.data.id}`).set('Authorization', fan.auth);
    expect(orphan.body.data).toMatchObject({ content: 'So true', repostOf: { unavailable: true } });
  });

  it('refuses to repost a connections-only post', async () => {
    const author = await createUser('MEMBER');
    const friend = await createUser('MEMBER');
    await connect(author, friend);
    const p = await post(author, { content: 'private', visibility: 'CONNECTIONS' });
    const res = await http().post(`/api/posts/${p.id}/repost`).set('Authorization', friend.auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_REPOSTABLE');
  });
});

describe('visibility, follows and feed tabs', () => {
  it('shows CONNECTIONS posts only to connections, and the following tab only followed people', async () => {
    const author = await createUser('MEMBER');
    const friend = await createUser('MEMBER');
    const stranger = await createUser('MEMBER');
    await connect(author, friend);
    const secret = await post(author, { content: `secret ${Date.now()}`, visibility: 'CONNECTIONS' });

    expect((await http().get(`/api/posts/${secret.id}`).set('Authorization', friend.auth)).status).toBe(200);
    expect((await http().get(`/api/posts/${secret.id}`).set('Authorization', stranger.auth)).status).toBe(404);
    expect((await http().get(`/api/posts/${secret.id}`)).status).toBe(404);

    const strangerFeed = await http().get('/api/feed?tab=latest&limit=50').set('Authorization', stranger.auth);
    expect(strangerFeed.body.data.items.map((i: any) => i.id)).not.toContain(secret.id);

    const loud = await createUser('MEMBER');
    const loudPost = await post(loud, { content: 'follow me' });
    let following = await http().get('/api/feed?tab=following').set('Authorization', stranger.auth);
    expect(following.body.data.items.map((i: any) => i.id)).not.toContain(loudPost.id);

    const f = await http().post(`/api/users/${loud.user.id}/follow`).set('Authorization', stranger.auth);
    expect(f.body.data).toEqual({ following: true, followerCount: 1 });
    following = await http().get('/api/feed?tab=following').set('Authorization', stranger.auth);
    expect(following.body.data.items.map((i: any) => i.id)).toContain(loudPost.id);

    const profile = await http().get(`/api/users/${loud.user.id}`).set('Authorization', stranger.auth);
    expect(profile.body.data).toMatchObject({ followerCount: 1, followingCount: 0, isFollowing: true });
    const followers = await http().get(`/api/users/${loud.user.id}/followers`).set('Authorization', stranger.auth);
    expect(followers.body.data.items.map((i: any) => i.id)).toEqual([stranger.user.id]);
  });

  it('for-you ranks an engaging recent post above a quiet one and pages with a cursor', async () => {
    const viewer = await createUser('MEMBER');
    const a = await createUser('MEMBER');
    const quiet = await post(a, { content: 'quiet' });
    const busy = await post(a, { content: 'busy' });
    await prisma.post.update({ where: { id: busy.id }, data: { likeCount: 500, commentCount: 100 } });

    const page1 = await http().get('/api/feed?limit=2').set('Authorization', viewer.auth);
    expect(page1.status).toBe(200);
    const ids: string[] = page1.body.data.items.map((i: any) => i.id);
    const all: string[] = [...ids];
    let cursor = page1.body.data.nextCursor;
    while (cursor && all.length < 200) {
      const next = await http().get(`/api/feed?limit=50&cursor=${encodeURIComponent(cursor)}`).set('Authorization', viewer.auth);
      all.push(...next.body.data.items.map((i: any) => i.id));
      cursor = next.body.data.nextCursor;
    }
    expect(all.indexOf(busy.id)).toBeGreaterThanOrEqual(0);
    expect(all.indexOf(busy.id)).toBeLessThan(all.indexOf(quiet.id));
    expect(new Set(all).size).toBe(all.length);
    expect((await http().get('/api/feed?cursor=garbage').set('Authorization', viewer.auth)).status).toBe(400);
  });
});

describe('hashtags, saves and views', () => {
  it('parses hashtags, lists them and reports them as trending', async () => {
    const u = await createUser('MEMBER');
    const tag = `tag${Date.now()}`;
    const p = await post(u, { content: `Hello #${tag.toUpperCase()} and #${tag}` });
    expect(p.hashtags).toEqual([tag]);

    const list = await http().get(`/api/hashtags/${tag}/posts`);
    expect(list.body.data.items.map((i: any) => i.id)).toEqual([p.id]);
    const trending = await http().get('/api/hashtags/trending?days=1&limit=50');
    expect(trending.body.data).toContainEqual({ tag, postCount: 1 });
  });

  it('toggles saved posts and counts one view per member', async () => {
    const author = await createUser('MEMBER');
    const viewer = await createUser('MEMBER');
    const p = await post(author, { content: 'save me' });

    expect((await http().post(`/api/posts/${p.id}/save`).set('Authorization', viewer.auth)).body.data).toEqual({ saved: true });
    expect((await http().get('/api/saved').set('Authorization', viewer.auth)).body.data.items[0].id).toBe(p.id);
    expect((await http().post(`/api/posts/${p.id}/save`).set('Authorization', viewer.auth)).body.data).toEqual({ saved: false });

    await http().post(`/api/posts/${p.id}/view`).set('Authorization', viewer.auth).expect(200);
    await http().post(`/api/posts/${p.id}/view`).set('Authorization', viewer.auth).expect(200);
    await http().post(`/api/posts/${p.id}/view`).expect(200);
    await http().post(`/api/posts/${p.id}/view`).set('Authorization', author.auth).expect(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).viewCount).toBe(1);
  });
});

describe('reports and moderation', () => {
  it('report → admin removes the content → reports resolved and audited', async () => {
    const author = await createUser('MEMBER');
    const r1 = await createUser('MEMBER');
    const r2 = await createUser('MEMBER');
    const admin = await createUser('ADMIN');
    const p = await post(author, { content: 'spammy spam' });

    expect((await http().post(`/api/posts/${p.id}/report`).set('Authorization', r1.auth).send({ reason: 'SPAM' })).status).toBe(201);
    expect((await http().post(`/api/posts/${p.id}/report`).set('Authorization', r1.auth).send({ reason: 'SPAM' })).status).toBe(409);
    await http().post(`/api/posts/${p.id}/report`).set('Authorization', r2.auth).send({ reason: 'OTHER' }).expect(201);
    expect((await http().post(`/api/posts/${p.id}/report`).set('Authorization', author.auth).send({ reason: 'SPAM' })).status).toBe(400);

    const queue = await http().get('/api/admin/reports').set('Authorization', admin.auth);
    const item = queue.body.data.items.find((i: any) => i.post?.id === p.id);
    expect(item).toMatchObject({ reportCount: 2, contentSnapshot: 'spammy spam' });

    await http().patch(`/api/admin/reports/${item.id}`).set('Authorization', admin.auth).send({ action: 'REMOVE_CONTENT', note: 'spam' }).expect(200);

    expect(await prisma.post.findUnique({ where: { id: p.id } })).toBeNull();
    const closed = await prisma.contentReport.findMany({ where: { reporterId: { in: [r1.user.id, r2.user.id] } } });
    expect(closed.map((r) => r.status)).toEqual(['RESOLVED', 'RESOLVED']);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'CONTENT_REMOVED', entityId: p.id } });
    expect(audit).not.toBeNull();
  });
});

describe('video upload', () => {
  it('accepts a real MP4 and rejects a fake one by its content', async () => {
    const u = await createUser('MEMBER');
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64)]);

    const ok = await http().post('/api/posts/video').set('Authorization', u.auth).attach('video', mp4, { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(ok.status).toBe(201);
    const reel = await post(u, { content: 'campus', videoUrl: ok.body.data.url, isReel: true });
    expect((await http().get('/api/reels?limit=50')).body.data.items.map((i: any) => i.id)).toContain(reel.id);

    const fake = await http()
      .post('/api/posts/video')
      .set('Authorization', u.auth)
      .attach('video', Buffer.from('not a video at all'), { filename: 'a.mp4', contentType: 'video/mp4' });
    expect(fake.status).toBe(400);
    expect(fake.body.error.code).toBe('INVALID_FILE_TYPE');
  });
});
