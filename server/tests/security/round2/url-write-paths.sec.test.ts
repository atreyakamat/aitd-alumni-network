/**
 * ROUND 2 - every stored field that is rendered as a link or media source, on EVERY write path (create and update),
 * attacked with scheme/encoding variants. Anything but a 4xx for a hostile value means it reached the database.
 */
import { createUser, http, prisma } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

type U = Awaited<ReturnType<typeof createUser>>;

const HOSTILE_LINKS = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  '//evil.example/x',
  'ftp://evil.example/x',
  'https://paypal.com@evil.example/login',
  'https://user:secret@evil.example/',
  'https:\\\\evil.example',
  'http://good.example\\@evil.example',
  '\u0001https://evil.example',
  'https://evil.example/​',
  'ｊａｖａｓｃｒｉｐｔ:alert(1)',
  '%6Aavascript:alert(1)',
  'https://' + 'a'.repeat(2100),
];
const HOSTILE_MEDIA = [...HOSTILE_LINKS, '/UPLOADS/x.png', '/uploads/../../etc/passwd', '/uploads/..%2f..%2fsecret', '/uploads/a/./b.png', 'blob:https://evil.example/uuid', 'data:image/svg+xml,<svg onload=alert(1)>'];

let admin: U;
let member: U;
let eventId: string;
let jobId: string;
let articleId: string;
let chapterId: string;
let albumId: string;
let listingId: string;
let postId: string;

beforeAll(async () => {
  admin = await createUser('ADMIN');
  member = await createUser('MEMBER');
  eventId = (
    await prisma.event.create({
      data: { title: 'r2 event', description: 'd', createdById: admin.user.id, startDate: new Date(Date.now() + 86_400_000), status: 'PUBLISHED' },
    })
  ).id;
  jobId = (await prisma.jobOpportunity.create({ data: { postedById: member.user.id, title: 'r2 job', description: 'd'.repeat(30), company: 'ACME', status: 'PUBLISHED' } })).id;
  articleId = (await prisma.newsArticle.create({ data: { title: 'r2 news', slug: `r2-news-${Date.now()}`, content: 'c', authorId: admin.user.id, status: 'PUBLISHED' } })).id;
  chapterId = (await prisma.chapter.create({ data: { name: `r2 chapter ${Date.now()}`, region: 'R2' } })).id;
  albumId = (await prisma.galleryAlbum.create({ data: { title: 'r2 album', albumType: 'INSTITUTIONAL' } })).id;
  listingId = (
    await prisma.marketplaceListing.create({ data: { userId: member.user.id, title: 'r2 listing', category: 'Misc', description: 'd'.repeat(30) } })
  ).id;
  postId = (await prisma.post.create({ data: { userId: member.user.id, content: 'r2 post' } })).id;
});

const expectRejected = async (label: string, send: () => Promise<{ status: number }>) => {
  const res = await send();
  expect({ label, status: res.status >= 400 && res.status < 500 }).toEqual({ label, status: true });
};

describe('R2-12 marketplace website uses the shared allowlist (create and update)', () => {
  const body = (website: string) => ({ type: 'BUSINESS', title: 'Handmade goods', category: 'Crafts', description: 'd'.repeat(30), website });

  it.each(HOSTILE_LINKS)('create refuses %j', async (website) => {
    await expectRejected(website, () => http().post('/api/marketplace').set('Authorization', member.auth).send(body(website)));
  });

  it.each(HOSTILE_LINKS)('update refuses %j', async (website) => {
    await expectRejected(website, () => http().patch(`/api/marketplace/${listingId}`).set('Authorization', member.auth).send({ website }));
    expect((await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listingId } })).website).toBeNull();
  });

  it('still accepts an ordinary website', async () => {
    const res = await http().patch(`/api/marketplace/${listingId}`).set('Authorization', member.auth).send({ website: 'https://shop.example.com/about?x=1' });
    expect(res.status).toBe(200);
  });
});

describe('profile links and photos', () => {
  it.each(['linkedinUrl', 'twitterUrl', 'githubUrl', 'websiteUrl', 'profilePhotoUrl', 'coverPhotoUrl'])('%s refuses every hostile value', async (field) => {
    for (const value of HOSTILE_LINKS) {
      await expectRejected(`${field}=${value.slice(0, 30)}`, () => http().patch('/api/users/profile').set('Authorization', member.auth).send({ [field]: value }));
    }
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } });
    expect((stored as Record<string, unknown>)[field] ?? null).toBeNull();
  });
});

describe('content links and media on every other write path', () => {
  it('events: bannerUrl and joinLink (PATCH)', async () => {
    for (const value of HOSTILE_MEDIA) await expectRejected(`banner ${value.slice(0, 30)}`, () => http().patch(`/api/events/${eventId}`).set('Authorization', admin.auth).send({ bannerUrl: value }));
    for (const value of HOSTILE_LINKS) await expectRejected(`join ${value.slice(0, 30)}`, () => http().patch(`/api/events/${eventId}`).set('Authorization', admin.auth).send({ joinLink: value }));
  });

  it('events: bannerUrl and joinLink (create)', async () => {
    const base = { title: 'r2 new event', description: 'd', startDate: new Date(Date.now() + 86_400_000 * 5).toISOString() };
    for (const value of HOSTILE_MEDIA) await expectRejected(`banner ${value.slice(0, 30)}`, () => http().post('/api/events').set('Authorization', admin.auth).send({ ...base, bannerUrl: value }));
    for (const value of HOSTILE_LINKS) await expectRejected(`join ${value.slice(0, 30)}`, () => http().post('/api/events').set('Authorization', admin.auth).send({ ...base, joinLink: value }));
  });

  it('jobs: applicationLink (PATCH and create)', async () => {
    for (const value of HOSTILE_LINKS) {
      await expectRejected(`patch ${value.slice(0, 30)}`, () => http().patch(`/api/jobs/${jobId}`).set('Authorization', member.auth).send({ applicationLink: value }));
      await expectRejected(`create ${value.slice(0, 30)}`, () =>
        http().post('/api/jobs').set('Authorization', member.auth).send({ title: 'Engineer', description: 'd'.repeat(30), company: 'ACME', applicationLink: value })
      );
    }
  });

  it('news: featuredImage (PATCH and create)', async () => {
    for (const value of HOSTILE_MEDIA) {
      await expectRejected(`patch ${value.slice(0, 30)}`, () => http().patch(`/api/news/${articleId}`).set('Authorization', admin.auth).send({ featuredImage: value }));
      await expectRejected(`create ${value.slice(0, 30)}`, () => http().post('/api/news').set('Authorization', admin.auth).send({ title: 'T', content: 'c'.repeat(30), featuredImage: value }));
    }
  });

  it('chapters: logoUrl (PATCH and create)', async () => {
    for (const value of HOSTILE_MEDIA) {
      await expectRejected(`patch ${value.slice(0, 30)}`, () => http().patch(`/api/chapters/${chapterId}`).set('Authorization', admin.auth).send({ logoUrl: value }));
      await expectRejected(`create ${value.slice(0, 30)}`, () => http().post('/api/chapters').set('Authorization', admin.auth).send({ name: `x${Math.random()}`, region: 'r', logoUrl: value }));
    }
  });

  it('gallery: album cover and admin photo url/thumbnail', async () => {
    for (const value of HOSTILE_MEDIA) {
      await expectRejected(`cover ${value.slice(0, 30)}`, () => http().patch(`/api/gallery/albums/${albumId}`).set('Authorization', admin.auth).send({ coverPhotoUrl: value }));
      await expectRejected(`photo ${value.slice(0, 30)}`, () => http().post('/api/gallery/photos/admin').set('Authorization', admin.auth).send({ albumId, url: value }));
      await expectRejected(`thumb ${value.slice(0, 30)}`, () =>
        http().post('/api/gallery/photos/admin').set('Authorization', admin.auth).send({ albumId, url: 'https://ok.example/a.png', thumbnailUrl: value })
      );
    }
  });

  it('posts: mediaUrls, videoUrl, thumbnailUrl, linkUrl (create and PATCH)', async () => {
    for (const value of HOSTILE_MEDIA) {
      await expectRejected(`media ${value.slice(0, 30)}`, () => http().post('/api/posts').set('Authorization', member.auth).send({ content: 'x', mediaUrls: [value] }));
      await expectRejected(`video ${value.slice(0, 30)}`, () => http().post('/api/posts').set('Authorization', member.auth).send({ content: 'x', videoUrl: value, isReel: true }));
      await expectRejected(`thumb ${value.slice(0, 30)}`, () => http().post('/api/posts').set('Authorization', member.auth).send({ content: 'x', thumbnailUrl: value }));
      await expectRejected(`patch media ${value.slice(0, 30)}`, () => http().patch(`/api/posts/${postId}`).set('Authorization', member.auth).send({ mediaUrls: [value] }));
    }
    for (const value of HOSTILE_LINKS) {
      await expectRejected(`link ${value.slice(0, 30)}`, () => http().post('/api/posts').set('Authorization', member.auth).send({ content: 'x', linkUrl: value }));
      await expectRejected(`patch link ${value.slice(0, 30)}`, () => http().patch(`/api/posts/${postId}`).set('Authorization', member.auth).send({ linkUrl: value }));
    }
  });

  it('messages: mediaUrl', async () => {
    const other = await createUser('MEMBER');
    for (const value of HOSTILE_MEDIA) {
      await expectRejected(`msg ${value.slice(0, 30)}`, () => http().post(`/api/messages/${other.user.id}`).set('Authorization', member.auth).send({ content: 'hi', mediaUrl: value }));
    }
  });

  it('nothing hostile was stored by any of the above', async () => {
    const stored = await Promise.all([
      prisma.event.findUniqueOrThrow({ where: { id: eventId } }),
      prisma.jobOpportunity.findUniqueOrThrow({ where: { id: jobId } }),
      prisma.newsArticle.findUniqueOrThrow({ where: { id: articleId } }),
      prisma.chapter.findUniqueOrThrow({ where: { id: chapterId } }),
      prisma.galleryAlbum.findUniqueOrThrow({ where: { id: albumId } }),
      prisma.post.findUniqueOrThrow({ where: { id: postId } }),
    ]);
    const dump = JSON.stringify(stored);
    expect(dump).not.toMatch(/javascript:|data:text|vbscript|evil\.example|file:\/\//i);
  });
});
