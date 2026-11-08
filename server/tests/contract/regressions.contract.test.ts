/**
 * Regression tests for defects found by the client/server contract sweep (QA-xx). Each one failed before
 * its fix: a request the client (or any caller) can legitimately make was silently altered, dropped or
 * crashed the handler with a 5xx.
 */
import request from 'supertest';
import { app } from '../integration/helpers';
import * as fx from './fixtures';
import type { Users } from './fixtures';

let u: Users;

beforeAll(async () => {
  u = await fx.makeUsers();
}, 60000);

afterAll(async () => {
  await fx.prisma.$disconnect();
});

const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string, as?: keyof Users) => {
  const r = (request(app) as any)[method](`/api${path}`);
  return as ? r.set('Authorization', u[as].auth) : r;
};

describe('QA-02 directory search', () => {
  it('filters by the `search` parameter the client sends (not only `name`)', async () => {
    const needle = `Zyxwvut${Date.now().toString(36)}`;
    await fx.newUser('MEMBER').then((x) => fx.prisma.user.update({ where: { id: x.user.id }, data: { fullName: `${needle} Person` } }));

    const res = await api('get', '/users/directory', 'member').query({ search: needle });
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: any) => p.fullName)).toEqual([`${needle} Person`]);
    expect(res.body.pagination.total).toBe(1);
  });

  it('also matches designation, company and skills (the box says "name, company, skills")', async () => {
    const tag = `Wxyzq${Date.now().toString(36)}`;
    const byCompany = await fx.newUser('MEMBER');
    await fx.prisma.workExperience.create({ data: { userId: byCompany.user.id, company: `${tag} Industries`, role: 'Dev', startDate: new Date('2020-01-01') } });
    const bySkill = await fx.newUser('MEMBER');
    const skill = await fx.prisma.skill.create({ data: { name: `${tag} Skill` } });
    await fx.prisma.userSkill.create({ data: { userId: bySkill.user.id, skillId: skill.id } });
    const byTitle = await fx.newUser('MEMBER');
    await fx.prisma.user.update({ where: { id: byTitle.user.id }, data: { currentDesignation: `Head of ${tag}` } });

    const res = await api('get', '/users/directory', 'member').query({ search: tag.toLowerCase() });
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: any) => p.id).sort()).toEqual([byCompany.user.id, bySkill.user.id, byTitle.user.id].sort());
  });

  it('still honours `name`', async () => {
    const needle = `Qwertyu${Date.now().toString(36)}`;
    await fx.newUser('MEMBER').then((x) => fx.prisma.user.update({ where: { id: x.user.id }, data: { fullName: `${needle} Named` } }));
    const res = await api('get', '/users/directory', 'member').query({ name: needle });
    expect(res.body.data.map((p: any) => p.fullName)).toEqual([`${needle} Named`]);
  });
});

describe('QA-03 NUL bytes in a path parameter', () => {
  it.each(['/posts/%00', '/users/%00', '/news/%00', '/events/%00', '/chapters/%00', '/marketplace/%00'])(
    'GET %s is a 400, not a database error',
    async (path) => {
      const res = await api('get', path, 'member');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_PATH');
    }
  );
});

describe('QA-04 chapter edits are validated', () => {
  it('rejects a blank name or region instead of storing it', async () => {
    const chapter = await fx.newChapter(u.chapterAdmin.user.id);
    for (const body of [{ name: '' }, { name: '   ' }, { region: '' }]) {
      const res = await api('patch', `/chapters/${chapter.id}`, 'chapterAdmin').send(body);
      expect(res.status).toBe(400);
    }
    const stored = await fx.prisma.chapter.findUniqueOrThrow({ where: { id: chapter.id } });
    expect(stored.name).toBe(chapter.name);
    expect(stored.region).toBe(chapter.region);
  });

  it('rejects wrong types with a 400', async () => {
    const chapter = await fx.newChapter(u.chapterAdmin.user.id);
    for (const body of [{ description: 5 }, { region: ['x'] }, { name: null }]) {
      const res = await api('patch', `/chapters/${chapter.id}`, 'chapterAdmin').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('a duplicate chapter name is a 409', async () => {
    const a = await fx.newChapter();
    const b = await fx.newChapter();
    const res = await api('patch', `/chapters/${b.id}`, 'admin').send({ name: a.name });
    expect(res.status).toBe(409);
  });

  it('assigning a chapter admin needs a userId string', async () => {
    const chapter = await fx.newChapter();
    for (const body of [{}, { userId: 5 }, { userId: null }, { userId: ['x'] }]) {
      const res = await api('put', `/chapters/${chapter.id}/admin`, 'admin').send(body);
      expect(res.status).toBe(400);
    }
    const ok = await api('put', `/chapters/${chapter.id}/admin`, 'admin').send({ userId: u.third.user.id });
    expect(ok.status).toBe(200);
  });
});

describe('QA-05 references to records that do not exist are a 4xx', () => {
  it('an album for an unknown event', async () => {
    const res = await api('post', '/gallery/albums', 'admin').send({ title: 'Ghost event', albumType: 'EVENT', eventId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REFERENCE');
  });

  it('a chapter whose admin does not exist', async () => {
    const res = await api('post', '/chapters', 'admin').send({ name: fx.uniq('Ghost admin'), region: 'Pune', adminUserId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(400);
  });
});

describe('QA-06 admin content routes validate field types', () => {
  it('albums', async () => {
    const album = await fx.newAlbum();
    for (const body of [{ description: 5 }, { isPublic: 'yes' }, { isPublic: null }, { batchYear: 'abc' }, { eventId: 5 }]) {
      const res = await api('patch', `/gallery/albums/${album.id}`, 'admin').send(body);
      expect(res.status).toBe(400);
    }
    for (const body of [{ title: 'T', description: [] }, { title: 'T', isPublic: 'maybe' }, { title: 'T', albumType: 'BATCH', batchYear: 'abc' }]) {
      const res = await api('post', '/gallery/albums', 'admin').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('photos', async () => {
    const album = await fx.newAlbum();
    for (const body of [
      { albumId: 5, url: '/uploads/a.png' },
      { albumId: album.id, url: '/uploads/a.png', caption: {} },
      { albumId: album.id, url: '/uploads/a.png', thumbnailUrl: 7 },
    ]) {
      const res = await api('post', '/gallery/photos/admin', 'admin').send(body);
      expect(res.status).toBe(400);
    }
  });

  it('news', async () => {
    const article = await fx.newArticle(u.admin.user.id, 'DRAFT');
    for (const body of [{ excerpt: 5 }, { excerpt: [] }, { category: null }, { category: '' }]) {
      const res = await api('patch', `/news/${article.id}`, 'admin').send(body);
      expect(res.status).toBe(400);
    }
    const created = await api('post', '/news', 'admin').send({ title: 'T', content: 'C '.repeat(20), excerpt: { a: 1 } });
    expect(created.status).toBe(400);
  });

  it('events', async () => {
    const event = await fx.newEvent(u.admin.user.id);
    for (const body of [{ city: 5 }, { venue: [] }, { address: {} }, { joinLink: 5 }]) {
      const res = await api('patch', `/events/${event.id}`, 'admin').send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe('QA-07 payment verification payloads must be strings', () => {
  it.each(['/donations/verify', '/memberships/verify'])('%s answers 400 to non-string Razorpay fields', async (path) => {
    for (const bad of [5, true, ['x'], { a: 1 }]) {
      const res = await api('post', path, 'member').send({ razorpay_order_id: bad, razorpay_payment_id: 'pay_x', razorpay_signature: 'sig' });
      expect(res.status).toBe(400);
      const res2 = await api('post', path, 'member').send({ razorpay_order_id: 'order_x', razorpay_payment_id: bad, razorpay_signature: 'sig' });
      expect(res2.status).toBe(400);
    }
  });
});

describe('QA-08 list filters tolerate repeated or nested query values', () => {
  it.each([
    ['/mentorship/mentors', 'search', 'member'],
    ['/mentorship/mentors', 'focusArea', 'member'],
    ['/mentorship/requests/mentor', 'status', 'member'],
    ['/mentorship/requests/mentee', 'status', 'member'],
    ['/admin/users', 'search', 'admin'],
  ] as const)('%s with repeated, array and object %s values is not a 500', async (path, name, as) => {
    for (const qs of [`${name}[]=a&${name}[]=b`, `${name}=a&${name}=b`, `${name}[x]=y`]) {
      const res = await api('get', `${path}?${qs}`, as);
      expect(res.status).toBeLessThan(500);
    }
  });
});

describe('QA-01 comment edits keep mentions', () => {
  it('stores the people mentioned in an edited comment', async () => {
    const post = await fx.newPost(u.member.user.id);
    const comment = await fx.newComment(u.member.user.id, post.id);
    const res = await api('patch', `/comments/${comment.id}`, 'member').send({ content: 'Edited with a mention', mentionIds: [u.other.user.id] });
    expect(res.status).toBe(200);
    const mentions = await fx.prisma.commentMention.findMany({ where: { commentId: comment.id } });
    expect(mentions.map((m) => m.userId)).toEqual([u.other.user.id]);
  });
});
