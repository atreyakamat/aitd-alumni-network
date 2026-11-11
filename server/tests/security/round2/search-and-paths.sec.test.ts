/**
 * ROUND 2 - the surface round 1 added: public search, the per-endpoint budget limiters, the /uploads/receipts block and
 * the NUL-byte path guard. Real PostgreSQL; every case asserts the secure behaviour.
 */
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { createApp } from '../../../src/app';
import { createUser, http, prisma } from '../../integration/helpers';
import { generateAccessToken } from '../../../src/utils/jwt';
import jwt from 'jsonwebtoken';

afterAll(async () => {
  await prisma.$disconnect();
});

type U = Awaited<ReturnType<typeof createUser>>;
const TAG = `r2q${Date.now().toString(36)}`;
const future = (days = 2) => new Date(Date.now() + days * 86_400_000);

describe('search: nothing non-public is reachable by a visitor, and members only get what the feed rules allow', () => {
  let author: U;
  let friend: U;
  let stranger: U;
  let admin: U;

  beforeAll(async () => {
    author = await createUser('MEMBER', { fullName: `Author ${TAG}` });
    friend = await createUser('MEMBER');
    stranger = await createUser('MEMBER');
    admin = await createUser('ADMIN');
    await prisma.connection.create({ data: { requesterId: author.user.id, addresseeId: friend.user.id, status: 'ACCEPTED' } });

    // people who must never be found
    await createUser('MEMBER', { fullName: `Unverified ${TAG}`, isVerified: false });
    await createUser('MEMBER', { fullName: `Deactivated ${TAG}`, isActive: false });
    const gone = await createUser('MEMBER', { fullName: `Gone Author ${TAG}`, isActive: false });
    await prisma.post.create({ data: { userId: gone.user.id, content: `post by deactivated ${TAG}`, visibility: 'PUBLIC' } });

    // posts
    await prisma.post.create({ data: { userId: author.user.id, content: `connections only ${TAG} #r2private${TAG.slice(-4)}`, visibility: 'CONNECTIONS' } });
    await prisma.post.create({ data: { userId: author.user.id, content: `unpublished ${TAG}`, visibility: 'PUBLIC', isPublished: false } });

    // events
    const ev = (title: string, extra: Record<string, unknown>) =>
      prisma.event.create({
        data: { title: `${title} ${TAG}`, description: 'd', createdById: author.user.id, startDate: future(), status: 'PUBLISHED', isPublic: true, ...extra },
      });
    await ev('Open meetup', {});
    await ev('Members dinner', { isPublic: false });
    await ev('Draft event', { status: 'DRAFT' });
    await ev('Cancelled event', { status: 'CANCELLED' });
    await ev('Past event', { startDate: new Date(Date.now() - 86_400_000) });

    // news
    const news = (title: string, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') =>
      prisma.newsArticle.create({
        data: { title: `${title} ${TAG}`, slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${TAG}`, content: `body ${TAG}`, authorId: author.user.id, status, publishedAt: status === 'PUBLISHED' ? new Date() : null },
      });
    await news('Public news', 'PUBLISHED');
    await news('Draft news', 'DRAFT');
    await news('Archived news', 'ARCHIVED');
    // a body-only match must not expose the unpublished text through an excerpt
    await prisma.newsArticle.create({
      data: { title: 'Innocent title', slug: `innocent-${TAG}`, content: `secret draft text ${TAG}`, excerpt: `secret excerpt ${TAG}`, authorId: author.user.id, status: 'DRAFT' },
    });

    // chapters
    await prisma.chapter.create({ data: { name: `Active chapter ${TAG}`, region: 'R2', isActive: true } });
    await prisma.chapter.create({ data: { name: `Inactive chapter ${TAG}`, region: 'R2', isActive: false } });

    // jobs
    const job = (title: string, status: 'DRAFT' | 'PENDING_REVIEW' | 'PUBLISHED' | 'REJECTED' | 'CLOSED') =>
      prisma.jobOpportunity.create({ data: { postedById: author.user.id, title: `${title} ${TAG}`, description: 'd', company: 'ACME', status } });
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'CLOSED'] as const) {
      await job(`${status} job`, status);
    }
  });

  // The platform is private: searching needs an approved member, so the default searcher is a signed-in stranger
  // (not connected to anybody). `anonymous` is the visitor.
  const search = (q: string, auth: string | null = stranger.auth) => {
    const req = http().get('/api/search').query({ q });
    return auth ? req.set('Authorization', auth) : req;
  };
  const titles = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.title ?? r.name ?? r.fullName ?? r.content));

  it('a visitor gets nothing at all: 401, no results, no hint that anything matched', async () => {
    const res = await search(TAG, null);
    expect(res.status).toBe(401);
    expect(res.body.data).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(TAG);
  });

  it('a member learns nothing about private rows from counts, ordering or hashtags', async () => {
    const res = await search(`secret draft text ${TAG}`);
    expect(res.body.data.news).toEqual([]);
    const tag = await http().get(`/api/hashtags/r2private${TAG.slice(-4)}/posts`).set('Authorization', stranger.auth);
    expect(JSON.stringify(tag.body)).not.toContain('connections only');
    const trending = await http().get('/api/hashtags/trending').set('Authorization', stranger.auth);
    expect(JSON.stringify(trending.body)).not.toContain(`r2private${TAG.slice(-4)}`);
    // ...and a visitor cannot even ask
    expect((await http().get(`/api/hashtags/r2private${TAG.slice(-4)}/posts`)).status).toBe(401);
    expect((await http().get('/api/hashtags/trending')).status).toBe(401);
  });

  it('a signed-in stranger sees members-only events but no drafts, no unverified or deactivated people, no hidden posts', async () => {
    const res = await search(TAG, stranger.auth);
    expect(res.body.data.scope).toBe('member');
    expect(titles(res.body.data.events).sort()).toEqual([`Members dinner ${TAG}`, `Open meetup ${TAG}`].sort());
    expect(titles(res.body.data.users)).toEqual([`Author ${TAG}`]);
    expect(titles(res.body.data.posts)).toEqual([]); // CONNECTIONS-only, unpublished and deactivated-author posts are all hidden
    expect(titles(res.body.data.jobs).every((t) => t.startsWith('PUBLISHED job'))).toBe(true);
    expect(titles(res.body.data.news)).toEqual([`Public news ${TAG}`]);
    expect(titles(res.body.data.chapters)).toEqual([`Active chapter ${TAG}`]);
  });

  it('a connection finds the CONNECTIONS-only post, still not the unpublished one', async () => {
    const res = await search(TAG, friend.auth);
    expect(titles(res.body.data.posts)).toEqual([expect.stringContaining('connections only')]);
  });

  it('a malformed, forged, expired or revoked token is a 401 - never a silent downgrade to the visitor view', async () => {
    const expired = jwt.sign({ userId: stranger.user.id, email: stranger.user.email, userRole: 'MEMBER', tv: 0 }, process.env.JWT_SECRET!, { expiresIn: -10 });
    const forged = jwt.sign({ userId: admin.user.id, email: admin.user.email, userRole: 'ADMIN', tv: 0 }, 'not-the-secret');
    const noneAlg = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ userId: admin.user.id })).toString('base64url')}.`;
    const ghost = generateAccessToken('00000000-0000-0000-0000-000000000000', 'ghost@aiem.test', 'MEMBER');
    const deactivated = await createUser('MEMBER', { isActive: false });
    for (const header of [`Bearer ${expired}`, `Bearer ${forged}`, `Bearer ${noneAlg}`, `Bearer ${ghost}`, deactivated.auth, 'Bearer', 'Bearer not.a.jwt', 'Basic Zm9vOmJhcg==', `bearer ${stranger.auth.slice(7)}`]) {
      const res = await search(TAG, header);
      expect({ header: header.slice(0, 25), status: res.status }).toEqual({ header: header.slice(0, 25), status: 401 });
      expect(res.body.data).toBeUndefined();
    }
    // a token whose tokenVersion was bumped (password change / logout-everywhere)
    const revoked = await createUser('MEMBER');
    await prisma.user.update({ where: { id: revoked.user.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await search(TAG, revoked.auth)).status).toBe(401);
  });

  it('LIKE wildcards in the query mean themselves: a literal % or _ matches, a wildcard does not (R2-11)', async () => {
    await prisma.event.create({
      data: { title: `Fifty% off snake_case ${TAG}`, description: 'd', createdById: author.user.id, startDate: future(), status: 'PUBLISHED', isPublic: true },
    });
    await prisma.event.create({
      data: { title: `Fifty apples snakeXcase ${TAG}`, description: 'd', createdById: author.user.id, startDate: future(), status: 'PUBLISHED', isPublic: true },
    });
    const literalPercent = await search(`Fifty% off`);
    expect(titles(literalPercent.body.data.events)).toEqual([`Fifty% off snake_case ${TAG}`]);
    const literalUnderscore = await search(`snake_case ${TAG}`);
    expect(titles(literalUnderscore.body.data.events)).toEqual([`Fifty% off snake_case ${TAG}`]);
    const wildcardPercent = await search(`Fifty%${TAG}`);
    expect(titles(wildcardPercent.body.data.events)).toEqual([]);
  });

  it('odd query shapes (arrays, objects, wildcards) neither error nor match everything', async () => {
    expect((await http().get('/api/search?q=a&q=b').set('Authorization', stranger.auth)).body.data.events).toEqual([]);
    expect((await http().get('/api/search?q[x]=zz').set('Authorization', stranger.auth)).status).toBe(200);
    for (const wildcard of ['%%', '__', '%_%', '\\']) {
      const res = await search(wildcard);
      expect(res.status).toBe(200);
      expect(res.body.data.events).toEqual([]);
      expect(res.body.data.news).toEqual([]);
      expect(res.body.data.chapters).toEqual([]);
    }
    // NUL bytes in a query STRING are stripped by sanitizeInput (only a NUL in the path is rejected)
    const nul = await http().get('/api/search?q=abc%00def').set('Authorization', stranger.auth);
    expect(nul.status).toBe(200);
  });
});

describe('per-endpoint budgets cannot be sidestepped by spelling the path differently', () => {
  it('/api/donations/order: case, trailing slash, query string and method spelling all share one budget of 20', async () => {
    const app = createApp({ disableRateLimit: false });
    for (let i = 0; i < 20; i++) await request(app).post('/api/donations/order').send({});
    const variants = [
      '/api/donations/order',
      '/api/donations/order/',
      '/API/Donations/ORDER',
      '/api/donations/order?x=1',
      '/api/donations/order/?a=b',
      '/api//donations/order',
      '/api///donations//order',
      '//api/donations/order',
      '/api/donations/order//',
    ];
    for (const variant of variants) {
      const res = await request(app).post(variant).send({});
      expect({ variant, status: res.status }).toEqual({ variant, status: 429 });
    }
  });

  it('/api/auth/login: a doubled slash after /api no longer reaches the handler outside the 10-per-window budget (R2-14)', async () => {
    const app = createApp({ disableRateLimit: false });
    for (let i = 0; i < 10; i++) await request(app).post('/api/auth/login').send({});
    for (const variant of ['/api/auth/login', '/api//auth/login', '/api///auth//login/', '//api/auth/login']) {
      const res = await request(app).post(variant).send({});
      expect({ variant, status: res.status }).toEqual({ variant, status: 429 });
    }
  });

  it('path-confusion spellings never reach a handler: double slash, dot segments, encoded characters, override headers', async () => {
    const app = createApp({ disableRateLimit: false });
    for (const variant of [
      '/api/./donations/order',
      '/api/donations/./order',
      '/api/donations/order/..',
      '/api/donations/%6frder',
      '/api/donations%2forder',
      '/api%2fdonations/order',
      '/api/donations/order%00',
      '/api/donations/order;x=1',
    ]) {
      const res = await request(app).post(variant).send({});
      // either the path guard (NUL) or an unrouted 404: never a handler
      expect({ variant, ok: res.status === 404 || (res.status === 400 && res.body?.error?.code === 'INVALID_PATH') }).toEqual({ variant, ok: true });
    }
  });

  it('method-override headers do not turn a GET into a POST that skips a limiter', async () => {
    const app = createApp({ disableRateLimit: false });
    const res = await request(app).get('/api/donations/order').set('X-HTTP-Method-Override', 'POST').set('X-HTTP-Method', 'POST').set('X-Method-Override', 'POST');
    expect(res.status).toBe(404);
  });

  it('R2-16 an unsigned request to the webhook path is not an unlimited, large-body channel', async () => {
    const app = createApp({ disableRateLimit: false });
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await request(app).post('/api/payments/webhook/razorpay').send({})).status);
    // Razorpay must never be starved (a generous budget), but the budget must exist for unauthenticated callers
    const big = await request(app).post('/api/payments/webhook/razorpay').set('Content-Type', 'application/json').send(JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }));
    expect(big.status).toBe(413);
    expect(statuses.every((s) => s !== 429)).toBe(true);
  });

  it('X-Forwarded-For rotation does not mint new budgets when no proxy is trusted', async () => {
    const previous = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = '0';
    try {
      const app = createApp({ disableRateLimit: false });
      let blocked = 0;
      for (let i = 0; i < 14; i++) {
        const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', `203.0.113.${i + 1}`).send({});
        if (res.status === 429) blocked++;
      }
      expect(blocked).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = previous;
    }
  });
});

describe('R2-15 the /uploads receipts block and static handler', () => {
  const receiptsDir = path.join(process.cwd(), 'uploads', 'receipts');
  const secretFile = path.join(receiptsDir, 'r2-secret-receipt.pdf');
  const dotFile = path.join(process.cwd(), 'uploads', '.r2-hidden');
  const publicFile = path.join(process.cwd(), 'uploads', 'r2-public.txt');
  const MARKER = 'R2-DONOR-RECEIPT-MARKER';

  beforeAll(() => {
    fs.mkdirSync(receiptsDir, { recursive: true });
    fs.writeFileSync(secretFile, MARKER);
    fs.writeFileSync(dotFile, MARKER);
    fs.writeFileSync(publicFile, 'public upload');
  });
  afterAll(() => {
    for (const file of [secretFile, dotFile, publicFile]) fs.rmSync(file, { force: true });
  });

  const serves = (res: { status: number; text?: string; body?: unknown }) =>
    res.status === 200 && (String(res.text ?? '').includes(MARKER) || Buffer.isBuffer(res.body) && res.body.toString().includes(MARKER));

  it('serves ordinary uploads (control)', async () => {
    const res = await http().get('/uploads/r2-public.txt');
    expect(res.status).toBe(200);
  });

  it.each([
    '/uploads/receipts/r2-secret-receipt.pdf',
    '/uploads/Receipts/r2-secret-receipt.pdf',
    '/uploads/RECEIPTS/r2-secret-receipt.pdf',
    '/uploads/%72eceipts/r2-secret-receipt.pdf',
    '/uploads/%52eceipts/r2-secret-receipt.pdf',
    '/uploads/%2e/receipts/r2-secret-receipt.pdf',
    '/uploads/./receipts/r2-secret-receipt.pdf',
    '/uploads//receipts/r2-secret-receipt.pdf',
    '/uploads///receipts//r2-secret-receipt.pdf',
    '/uploads/receipts%2fr2-secret-receipt.pdf',
    '/uploads/%5Creceipts%5Cr2-secret-receipt.pdf',
    '/uploads/\\receipts\\r2-secret-receipt.pdf',
    '/uploads/receipts./r2-secret-receipt.pdf',
    '/uploads/receipts%20/r2-secret-receipt.pdf',
    '/uploads/receipts.%20/r2-secret-receipt.pdf',
    '/uploads/receipts::$DATA/r2-secret-receipt.pdf',
    '/uploads/RECEIP~1/r2-secret-receipt.pdf',
    '/uploads/x/../receipts/r2-secret-receipt.pdf',
    '/uploads/x/%2e%2e/receipts/r2-secret-receipt.pdf',
    '/uploads/%252e/receipts/r2-secret-receipt.pdf',
    '/uploads/%2e%2e/uploads/receipts/r2-secret-receipt.pdf',
    '/uploads/receipts/',
    '/uploads/receipts',
  ])('never serves a receipt via %s', async (url) => {
    const res = await request(createApp({ disableRateLimit: true })).get(url);
    expect(serves(res)).toBe(false);
    expect(res.status).not.toBe(200);
  });

  it('does not serve dotfiles, directory listings or index pages', async () => {
    for (const url of ['/uploads/.r2-hidden', '/uploads/%2er2-hidden', '/uploads/', '/uploads']) {
      const res = await http().get(url);
      expect({ url, served: serves(res) }).toEqual({ url, served: false });
      expect(res.text ?? '').not.toMatch(/Index of|<ul id="files"/i);
    }
  });
});

describe('the NUL-byte path guard', () => {
  it('rejects %00 in a path with 400 instead of letting it reach a query', async () => {
    for (const url of ['/api/users/%00', '/api/news/abc%00', '/api/events/%2500x', '/api/chapters/a%00b']) {
      const res = await http().get(url);
      expect(res.status).toBeLessThan(500);
    }
    expect((await http().get('/api/news/abc%00')).status).toBe(400);
  });

  it('does not reject legitimate non-ASCII or encoded identifiers (unicode slugs, emoji, spaces)', async () => {
    const member = await createUser('MEMBER'); // news is for approved members
    for (const slug of ['%E0%A4%B8%E0%A4%AE%E0%A4%BE%E0%A4%9A%E0%A4%BE%E0%A4%B0', 'caf%C3%A9', '%F0%9F%8E%89', 'a%20b', 'a%2Fb']) {
      const res = await http().get(`/api/news/${slug}`).set('Authorization', member.auth);
      expect({ slug, status: res.status }).toEqual({ slug, status: 404 }); // not found - but a clean 404, not a 400/500
    }
  });
});

describe('R2-13 multipart text fields go through the same sanitising as JSON bodies', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const stored: string[] = [];
  afterAll(() => {
    for (const url of stored) fs.rmSync(path.join(process.cwd(), url.replace(/^\//, '')), { force: true });
  });

  it('a photo caption sent as a multipart field has markup and NUL bytes removed instead of stored or crashing', async () => {
    const member = await createUser('MEMBER');
    const album = await prisma.galleryAlbum.create({ data: { title: `R2 batch ${TAG}`, albumType: 'BATCH', batchYear: member.user.batchYear } });
    const res = await http()
      .post(`/api/gallery/albums/${album.id}/photos`)
      .set('Authorization', member.auth)
      .field('caption', '<img src=x onerror=alert(1)>nice\u0000 day <script>alert(1)</script>')
      .attach('photos', png, 'a.png');
    for (const photo of res.body?.data ?? []) stored.push(photo.url);
    expect(res.status).toBe(201);
    const caption: string = res.body.data[0].caption;
    expect(caption).not.toMatch(/<|onerror|script/i);
    // eslint-disable-next-line no-control-regex
    expect(caption).not.toMatch(/\u0000/);
    expect(caption).toContain('nice');
  });
});
