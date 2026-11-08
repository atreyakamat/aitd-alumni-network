/**
 * ROUND 2 - account lifecycle: deletion completeness against the whole schema, data export completeness, and OAuth
 * linking edge cases.
 */
import fs from 'fs';
import path from 'path';
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';
import { resolveOAuthUser } from '../../../src/config/passport';

afterAll(async () => {
  await prisma.$disconnect();
});

const SERVER_ROOT = path.resolve(__dirname, '../../..');

// ---------------------------------------------------------------------------------------------------------------
// Which models point at a User, and what the deletion does with each. A NEW model that references a user fails the
// first test until someone decides (in deletion or in KEPT_ON_PURPOSE) what happens to its rows.
// ---------------------------------------------------------------------------------------------------------------
const KEPT_ON_PURPOSE: Record<string, string> = {
  post: 'authored content stays, attributed to "Deleted User" (hidden from feeds because the author is inactive)',
  postComment: 'threads stay consistent; the author is anonymised',
  postLike: 'aggregate reaction counts must not change',
  commentReaction: 'aggregate reaction counts must not change',
  postMention: 'mention rows belong to the post',
  commentMention: 'mention rows belong to the comment',
  contentReport: 'moderation evidence',
  message: 'the other party keeps their conversation; the sender is anonymised',
  donation: 'financial record',
  transaction: 'financial record (userId set null by the foreign key on hard delete)',
  userMembership: 'financial record',
  eventRSVP: 'headcount history',
  chapterMembership: 'member history',
  event: 'events created stay; the creator is anonymised',
  galleryPhoto: 'album contents stay; the uploader is anonymised',
  newsArticle: 'published articles stay; the author is anonymised',
  jobOpportunity: 'job listings stay; the poster is anonymised',
  mentorshipRequest: 'the counterpart keeps the history',
  chapter: 'chapter keeps existing; admin is anonymised',
  user: 'self-reference',
  mentorProfile: 'deactivated and emptied (updateMany), not deleted',
};

const referencingModels = (): string[] => {
  const schema = fs.readFileSync(path.join(SERVER_ROOT, 'prisma/schema.prisma'), 'utf8');
  const models: string[] = [];
  for (const block of schema.split(/^model /m).slice(1)) {
    const name = block.slice(0, block.indexOf(' ')).trim();
    if (name === 'User') continue;
    if (/^\s+\w+\s+User\??\s+@relation\(/m.test(block)) models.push(name.charAt(0).toLowerCase() + name.slice(1));
  }
  return models;
};

const handledByDeletion = (): Set<string> => {
  const source = fs.readFileSync(path.join(SERVER_ROOT, 'src/services/privacyService.ts'), 'utf8');
  return new Set([...source.matchAll(/tx\.(\w+)\.(?:deleteMany|updateMany|update|delete)\(/g)].map((m) => m[1]));
};

describe('R2-18 account deletion accounts for every model that references a user', () => {
  it('every user-referencing model is either removed/anonymised by deleteMyAccount or kept on purpose', () => {
    const handled = handledByDeletion();
    const undecided = referencingModels().filter((model) => !handled.has(model) && !(model in KEPT_ON_PURPOSE));
    expect(undecided).toEqual([]);
  });

  it('nothing is both deleted and listed as kept', () => {
    const handled = handledByDeletion();
    const contradictions = Object.keys(KEPT_ON_PURPOSE).filter((model) => handled.has(model) && !['user', 'mentorProfile'].includes(model));
    expect(contradictions).toEqual([]);
  });

  it('the audit trail keeps what was done but not where from: IP address and user agent are erased', async () => {
    const { user } = await createUser('MEMBER');
    await prisma.auditLog.createMany({
      data: [
        { userId: user.id, action: 'LOGIN', entityType: 'USER', entityId: user.id, ipAddress: '203.0.113.7', userAgent: 'R2-Test-Agent/1.0' },
        { userId: user.id, action: 'UPDATE', entityType: 'USER', entityId: user.id, ipAddress: '203.0.113.8', userAgent: 'R2-Test-Agent/2.0' },
      ],
    });
    const res = await http().delete('/api/users/me').set('Authorization', `Bearer ${(await login(user.email)).accessToken}`).send({ password: PASSWORD });
    expect(res.status).toBe(200);
    const logs = await prisma.auditLog.findMany({ where: { userId: user.id } });
    expect(logs.length).toBeGreaterThanOrEqual(2); // the record that something happened stays
    expect(logs.filter((l) => l.ipAddress || l.userAgent)).toEqual([]);
  });

  it('after deletion the account is unreachable: login, token, profile, directory and search', async () => {
    const { user } = await createUser('MEMBER', { fullName: 'Ephemeral Person r2gone' });
    const session = await login(user.email);
    const viewer = await createUser('MEMBER');
    const del = await http().delete('/api/users/me').set('Authorization', `Bearer ${session.accessToken}`).send({ password: PASSWORD });
    expect(del.status).toBe(200);

    expect((await http().post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status).toBe(401);
    expect((await http().get('/api/auth/me').set('Authorization', `Bearer ${session.accessToken}`)).status).toBe(401);
    expect((await http().post('/api/auth/refresh-token').send({ refreshToken: session.refreshToken })).status).toBe(401);
    expect((await http().get(`/api/users/${user.id}`).set('Authorization', viewer.auth)).status).toBe(404);
    const found = await http().get('/api/search').query({ q: 'r2gone' }).set('Authorization', viewer.auth);
    expect(JSON.stringify(found.body)).not.toContain('r2gone');
    // the e-mail address is free again and no trace of the old one remains on the row
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.email).not.toBe(user.email);
    expect(row.fullName).toBe('Deleted User');
  });
});

const login = async (email: string) => {
  const res = await http().post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.data as { accessToken: string; refreshToken: string };
};

describe('R2-19 the data export covers what the service holds about the member', () => {
  it('includes reactions, reports filed, gallery uploads and events created - and still no secrets', async () => {
    const me = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const post = await prisma.post.create({ data: { userId: other.user.id, content: 'exportable r2 post' } });
    const comment = await prisma.postComment.create({ data: { postId: post.id, userId: other.user.id, content: 'c' } });
    await prisma.postLike.create({ data: { postId: post.id, userId: me.user.id, type: 'LOVE' } });
    await prisma.commentReaction.create({ data: { commentId: comment.id, userId: me.user.id, type: 'LIKE' } });
    await prisma.contentReport.create({ data: { reporterId: me.user.id, postId: post.id, reason: 'SPAM', details: 'r2 report details' } });
    const album = await prisma.galleryAlbum.create({ data: { title: 'r2 export album', albumType: 'INSTITUTIONAL' } });
    await prisma.galleryPhoto.create({ data: { albumId: album.id, url: 'https://cdn.example/r2.png', uploadedById: me.user.id, caption: 'r2 photo' } });
    await prisma.event.create({ data: { title: 'r2 export event', description: 'd', createdById: me.user.id, startDate: new Date(Date.now() + 86_400_000), status: 'PUBLISHED' } });

    const res = await http().get('/api/users/me/export').set('Authorization', me.auth);
    expect(res.status).toBe(200);
    const data = res.body.data;
    const dump = JSON.stringify(data);
    expect(dump).toContain('LOVE'); // post reaction
    expect(dump).toContain('r2 report details');
    expect(dump).toContain('r2 photo');
    expect(dump).toContain('r2 export event');
    expect(dump).not.toMatch(/passwordHash|gatewaySignature|"token"/);
    // other people's content is not exported
    expect(dump).not.toContain('exportable r2 post');
  });
});

describe('OAuth linking edge cases', () => {
  const profile = (email: string, verified?: boolean | string) => ({
    id: 'p1',
    displayName: 'Provider Name',
    photos: [],
    emails: [{ value: email, ...(verified === undefined ? {} : { verified }) }],
  });

  it('matches the existing account regardless of the provider\'s letter case, but never across plus-tags or dots', async () => {
    const owner = await createUser('MEMBER');
    const upper = await resolveOAuthUser('google', profile(owner.user.email.toUpperCase(), true) as never);
    expect(upper.id).toBe(owner.user.id);
    expect(upper.isNewUser).toBe(false);

    const [local, domain] = owner.user.email.split('@');
    const plus = await resolveOAuthUser('google', profile(`${local}+evil@${domain}`, true) as never);
    expect(plus.id).not.toBe(owner.user.id);
    const dotted = await resolveOAuthUser('google', profile(`${local.replace('.', '..')}@${domain}`, true) as never);
    expect(dotted.id).not.toBe(owner.user.id);
  });

  it('refuses a provider e-mail that the provider has not verified and never touches the account', async () => {
    const owner = await createUser('MEMBER', { emailVerifiedAt: null, isVerified: false });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    for (const verified of [false, 'false'] as const) {
      await expect(resolveOAuthUser('google', profile(owner.user.email, verified) as never)).rejects.toThrow(/not verified/);
    }
    const after = await prisma.user.findUniqueOrThrow({ where: { id: owner.user.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.tokenVersion).toBe(before.tokenVersion);
  });

  it('cannot log in through an OAuth exchange code once the account is deactivated', async () => {
    const owner = await createUser('MEMBER');
    const resolved = await resolveOAuthUser('google', profile(owner.user.email, true) as never);
    const { authService } = await import('../../../src/services/authService');
    const code = await authService.createOAuthExchangeCode(resolved.id);
    await prisma.user.update({ where: { id: owner.user.id }, data: { isActive: false } });
    const res = await http().post('/api/auth/oauth/exchange').send({ code });
    expect(res.status).toBe(401);
  });

  it('an exchange code works once', async () => {
    const owner = await createUser('MEMBER');
    const { authService } = await import('../../../src/services/authService');
    const code = await authService.createOAuthExchangeCode(owner.user.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => http().post('/api/auth/oauth/exchange').send({ code })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it('R2-20 strips markup from a provider display name before it becomes the stored full name', async () => {
    const email = `oauth.${Date.now()}@aitd.test`;
    const created = await resolveOAuthUser('google', {
      ...profile(email, true),
      displayName: '<img src=x onerror=alert(1)>Mallory',
    } as never);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.fullName).not.toMatch(/[<>]|onerror/i);
    expect(row.fullName).toContain('Mallory');
    const long = await resolveOAuthUser('google', { ...profile(`long.${Date.now()}@aitd.test`, true), displayName: 'N'.repeat(5000) } as never);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: long.id } })).fullName.length).toBeLessThanOrEqual(100);
  });
});
