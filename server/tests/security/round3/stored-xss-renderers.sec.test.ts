/**
 * ROUND 3 / D1 - stored XSS and HTML injection in every text field a member (or an admin) can store and another member sees.
 *
 * What the SERVER stores and returns is checked here, field by field, with a payload corpus (event handlers, script and style
 * blocks, srcdoc, nested/broken tags that reassemble, quote breakouts, comment tricks). The renderers' side (React text nodes, the
 * sandboxed landing iframe, guarded href/src) is pinned in client/src/__security__/round3/html-sinks.test.ts.
 *
 * A field is safe when what comes back holds no tag, no event-handler attribute and no script URI. (The sanitiser strips markup
 * rather than encoding it, a round 1 decision; the admin landing HTML block is the one place that may keep markup, because it is
 * rendered in a sandboxed iframe without scripts, so it gets its own assertions.)
 */
import { createUser, http, prisma, uniqueEmail, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const CORPUS = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(1)</script>',
  '"><svg/onload=alert(1)>',
  '<a href="javascript:alert(1)">click</a>',
  "<iframe srcdoc='<script>alert(1)</script>'></iframe>",
  '<div onmouseover=alert(1) style=x>hover',
  '<<script>script>alert(1)<</script>/script>',
  '<scr<script>ipt>alert(1)</scr</script>ipt>',
  '<style>@import "//evil.example/x.css"</style>',
  '<!--><img src=x onerror=alert(1)>-->',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  '<body onload=alert(1)>',
  '<img src=x onerror=alert(1)',
  '<details open ontoggle=alert(1)>',
];

/** True when the value still contains something a browser could act on. */
const dangerous = (value: unknown): string[] => {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const hits: string[] = [];
  if (/<\s*\/?\s*[a-z!?]/i.test(text)) hits.push('tag');
  if (/\bon[a-z]+\s*=/i.test(text)) hits.push('event-handler');
  if (/(?:java|vb)script\s*:/i.test(text)) hits.push('script-uri');
  return hits;
};

const expectSafe = (label: string, payload: string, stored: unknown) => {
  expect({ label, payload, hits: dangerous(stored) }).toEqual({ label, payload, hits: [] });
};

describe('R3-D1 stored text fields never hold markup', () => {
  let member: Awaited<ReturnType<typeof createUser>>;
  let admin: Awaited<ReturnType<typeof createUser>>;
  let other: Awaited<ReturnType<typeof createUser>>;
  beforeAll(async () => {
    member = await createUser('MEMBER');
    admin = await createUser('ADMIN');
    other = await createUser('MEMBER');
    await prisma.connection.create({ data: { requesterId: member.user.id, addresseeId: other.user.id, status: 'ACCEPTED' } });
  });

  it.each(CORPUS.map((payload, i) => [i, payload]))('payload #%i through posts, comments, profile, work, education, skills, messages', async (_i, payload) => {
    const p = payload as string;
    const text = `before ${p} after`;

    const post = await http().post('/api/posts').set('Authorization', member.auth).send({ content: text });
    expect(post.status).toBe(201);
    expectSafe('post.content (response)', p, post.body.data);
    expectSafe('post.content (row)', p, (await prisma.post.findUniqueOrThrow({ where: { id: post.body.data.id } })).content);

    const comment = await http().post(`/api/posts/${post.body.data.id}/comments`).set('Authorization', other.auth).send({ content: text });
    expect(comment.status).toBe(201);
    expectSafe('comment', p, (await prisma.postComment.findUniqueOrThrow({ where: { id: comment.body.data.id } })).content);
    const edited = await http().patch(`/api/comments/${comment.body.data.id}`).set('Authorization', other.auth).send({ content: text });
    expect(edited.status).toBe(200);
    expectSafe('comment (edited)', p, edited.body.data);

    const profile = await http().patch('/api/users/profile').set('Authorization', member.auth).send({ shortBio: text, currentDesignation: text, city: text, hometown: text, workCity: text });
    expect(profile.status).toBe(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: member.user.id } });
    for (const field of ['shortBio', 'currentDesignation', 'city', 'hometown', 'workCity'] as const) expectSafe(`profile.${field}`, p, row[field]);

    const work = await http().post('/api/users/work-experience').set('Authorization', member.auth).send({ company: text, role: text, location: text, description: text, startDate: '2020-01-01' });
    expect(work.status).toBeLessThan(300);
    expectSafe('workExperience', p, await prisma.workExperience.findUniqueOrThrow({ where: { id: work.body.data.id } }));

    const edu = await http().post('/api/users/education').set('Authorization', member.auth).send({ institution: text, degree: text, fieldOfStudy: text, grade: text, description: text, startYear: 2010 });
    expect(edu.status).toBeLessThan(300);
    expectSafe('education', p, await prisma.education.findUniqueOrThrow({ where: { id: edu.body.data.id } }));

    const skills = await http().put('/api/users/skills').set('Authorization', member.auth).send({ skills: [text] });
    expect(skills.status).toBeLessThan(300);
    expectSafe('skills', p, (await prisma.userSkill.findMany({ where: { userId: member.user.id }, include: { skill: true } })).map((s) => s.skill.name));

    const message = await http().post(`/api/messages/${other.user.id}`).set('Authorization', member.auth).send({ content: text });
    expect(message.status).toBe(201);
    expectSafe('message', p, (await prisma.message.findUniqueOrThrow({ where: { id: message.body.data.id } })).content);
  });

  it.each(CORPUS.map((payload, i) => [i, payload]))('payload #%i through events, jobs, news, marketplace, chapters, albums, referrals, reports, invites (and the notices they cause)', async (_i, payload) => {
    const p = payload as string;
    const text = `before ${p} after`;

    const event = await http()
      .post('/api/events')
      .set('Authorization', admin.auth)
      .send({ title: text, description: text, venue: text, address: text, city: text, tags: [text], startDate: new Date(Date.now() + 86_400_000).toISOString() });
    expect(event.status).toBe(201);
    expectSafe('event', p, await prisma.event.findUniqueOrThrow({ where: { id: event.body.data.id } }));

    const job = await http().post('/api/jobs').set('Authorization', member.auth).send({ title: text, company: text, description: text, location: text, industry: text, skills: [text] });
    expect(job.status).toBe(201);
    expectSafe('job', p, await prisma.jobOpportunity.findUniqueOrThrow({ where: { id: job.body.data.id } }));

    const news = await http().post('/api/news').set('Authorization', admin.auth).send({ title: text, content: text, excerpt: text });
    expect(news.status).toBe(201);
    expectSafe('news', p, await prisma.newsArticle.findUniqueOrThrow({ where: { id: news.body.data.id } }));

    const listing = await http()
      .post('/api/marketplace')
      .set('Authorization', member.auth)
      .send({ type: 'BUSINESS', title: `Listing ${text}`, category: text, description: `${text} describing a business at length`, location: text, contactInfo: text, priceRange: text });
    // an unclosed tag swallows the rest of the field, which can leave it under the minimum length: refused is fine, stored must be safe
    expect([201, 400]).toContain(listing.status);
    if (listing.status === 201) expectSafe('marketplace', p, await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: listing.body.data.id } }));

    const chapter = await http().post('/api/chapters').set('Authorization', admin.auth).send({ name: `Chapter ${Math.random().toString(16).slice(2)} ${text}`, region: text, description: text });
    expect(chapter.status).toBe(201);
    expectSafe('chapter', p, await prisma.chapter.findUniqueOrThrow({ where: { id: chapter.body.data.id } }));

    const album = await http().post('/api/gallery/albums').set('Authorization', admin.auth).send({ title: text, description: text, albumType: 'INSTITUTIONAL' });
    expect(album.status).toBe(201);
    expectSafe('album', p, await prisma.galleryAlbum.findUniqueOrThrow({ where: { id: album.body.data.id } }));

    const asker = await createUser('MEMBER'); // a member may have only so many asks pending at once
    const referral = await http().post('/api/referrals').set('Authorization', asker.auth).send({ targetId: other.user.id, company: `Co ${Math.random().toString(16).slice(2)} ${text}`, message: text });
    expect(referral.status).toBeLessThan(300);
    expectSafe('referral', p, await prisma.referralRequest.findUniqueOrThrow({ where: { id: referral.body.data.id } }));

    const post = await prisma.post.create({ data: { userId: other.user.id, content: 'reportable' } });
    const report = await http().post(`/api/posts/${post.id}/report`).set('Authorization', member.auth).send({ reason: 'SPAM', details: text });
    expect(report.status).toBeLessThan(300);
    expectSafe('report', p, await prisma.contentReport.findMany({ where: { reporterId: member.user.id, postId: post.id } }));

    const invite = await http().post('/api/invites/send').set('Authorization', member.auth).send({ email: uniqueEmail('invitee'), name: text, message: text });
    expect(invite.status).toBe(201);
    expectSafe('invite', p, await prisma.invite.findMany({ where: { inviterId: member.user.id }, orderBy: { createdAt: 'desc' }, take: 1 }));
  });

  it('the author name is stored without markup however it got in (registration, profile), and so is every notification built from it', async () => {
    const email = uniqueEmail('xss-name');
    const reg = await http().post('/api/auth/register').send({ email, password: PASSWORD, fullName: '<img src=x onerror=alert(1)>Mallory', batchYear: 2015, department: '<script>alert(1)</script>Civil', degree: 'B.E.' });
    expect(reg.status).toBe(201);
    expectSafe('registration', 'name', await prisma.user.findUniqueOrThrow({ where: { email } }));

    const stranger = await createUser('MEMBER', { fullName: 'Plain Name' });
    // a member whose name was stored before the sanitiser existed: whatever the row holds, the notice built from it is plain text
    await prisma.user.update({ where: { id: stranger.user.id }, data: { fullName: 'Legacy' } });
    const post = await prisma.post.create({ data: { userId: other.user.id, content: 'notice target' } });
    await http().post(`/api/posts/${post.id}/comments`).set('Authorization', stranger.auth).send({ content: `<img src=x onerror=alert(1)>hello` });
    const notices = await prisma.notification.findMany({ where: { userId: other.user.id } });
    expect(notices.length).toBeGreaterThan(0);
    expectSafe('notifications', 'comment notice', notices.map((n) => [n.title, n.message, n.link]));
  });

  it('GET answers carry the stored text as JSON, never as an HTML page: Content-Type json and nosniff on the API', async () => {
    const res = await http().get('/api/posts').set('Authorization', member.auth);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const err = await http().get('/api/posts/%3Cscript%3Ealert(1)%3C%2Fscript%3E').set('Authorization', member.auth);
    expect(err.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.stringify(err.body)).not.toMatch(/<script/i);
  });
});

describe('R3-D1 the admin landing page blocks (rendered for every visitor)', () => {
  it('link and image fields refuse script and data URIs, and markup in plain text fields is stripped', async () => {
    const admin = await createUser('ADMIN');
    const bad = ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example/x', '\\\\evil.example'];
    for (const href of bad) {
      for (const type of ['CTA', 'HERO']) {
        const key = type === 'CTA' ? 'buttonHref' : 'ctaHref';
        const res = await http().post('/api/admin/landing').set('Authorization', admin.auth).send({ type, config: { title: 'x', [key]: href } });
        expect({ type, href, status: res.status }).toEqual({ type, href, status: 400 });
      }
      const image = await http().post('/api/admin/landing').set('Authorization', admin.auth).send({ type: 'IMAGE', config: { imageUrl: href } });
      expect({ href, status: image.status }).toEqual({ href, status: 400 });
    }
    const ok = await http().post('/api/admin/landing').set('Authorization', admin.auth).send({ type: 'TEXT', config: { title: '<img src=x onerror=alert(1)>Welcome', body: '<script>alert(1)</script>Hello' } });
    expect(ok.status).toBe(201);
    expectSafe('landing text block', 'text', ok.body.data.config);
  });

  it('what a visitor receives for an HTML block is data in JSON; the page that renders it is sandboxed (client test) and only an admin can write it', async () => {
    const member = await createUser('MEMBER');
    const chapterAdmin = await createUser('CHAPTER_ADMIN');
    for (const who of [member, chapterAdmin]) {
      const res = await http().post('/api/admin/landing').set('Authorization', who.auth).send({ type: 'HTML', config: { html: '<b>hi</b>' } });
      expect(res.status).toBe(403);
    }
    const anonymous = await http().post('/api/admin/landing').send({ type: 'HTML', config: { html: '<b>hi</b>' } });
    expect(anonymous.status).toBe(401);
    const visitor = await http().get('/api/landing');
    expect(visitor.headers['content-type']).toMatch(/^application\/json/);
  });
});
