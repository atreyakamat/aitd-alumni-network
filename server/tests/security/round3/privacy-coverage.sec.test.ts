/**
 * ROUND 3 / H3 (R3-16) - the data export and the account deletion cover the whole schema, and a new table or column cannot slip past them.
 *
 * (Round 2 already forces a decision for deletion: account-lifecycle.sec.test.ts. This adds the same rule for the EXPORT, and for
 * the columns of the user row itself, which is where personal data is most likely to be added later.)
 */
import fs from 'fs';
import path from 'path';
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const schema = fs.readFileSync(path.join(SERVER_ROOT, 'prisma/schema.prisma'), 'utf8');
const privacy = fs.readFileSync(path.join(SERVER_ROOT, 'src/services/privacyService.ts'), 'utf8');
const exportSection = privacy.slice(privacy.indexOf('async exportMyData'), privacy.indexOf('async deleteMyAccount'));

const lower = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);
const modelBlocks = () => schema.split(/^model /m).slice(1).map((block) => ({ name: block.slice(0, block.indexOf(' ')).trim(), body: block }));

/** Models that point at a User through a relation field. */
const referencingModels = () =>
  modelBlocks()
    .filter(({ name, body }) => name !== 'User' && /^\s+\w+\s+User\??\s+@relation\(/m.test(body))
    .map(({ name }) => lower(name));

/** Models the member's own export does not include, and why that is right. */
const NOT_EXPORTED: Record<string, string> = {
  refreshToken: 'credential (a session secret), never exported',
  verificationToken: 'credential (one-time links and attempt counters), never exported',
  workExperience: 'exported inside the profile (workExperiences)',
  education: 'exported inside the profile (educations)',
  userSkill: 'exported inside the profile (skills)',
  mentorProfile: 'exported inside the profile (mentorProfile)',
  postMention: 'a mention row belongs to the post that was exported; it holds no extra personal data',
  commentMention: 'a mention row belongs to the comment that was exported; it holds no extra personal data',
  newsArticle: 'published editorial content written for the college, attributed to an administrator account, not personal data of a member',
  collegeMagazine: 'issues uploaded by administrators on behalf of the college',
  collegeRequirement: 'requests posted by administrators on behalf of the college',
  chapter: 'a chapter administrator is a role on a chapter, shown through chapterMembership; the chapter is the college\'s record',
  landingBlock: 'site content, not personal data',
  alumniRecord: "a row of the college's own alumni list (imported by an administrator); only the importer reference points at a member, and it is cleared on deletion",
};

describe('R3-H3 the export names every table that holds something about a member', () => {
  it('each user-referencing model is exported, or listed with the reason it is not', () => {
    const missing = referencingModels().filter((model) => !new RegExp(`prisma\\.${model}\\.`).test(exportSection) && !(model in NOT_EXPORTED));
    expect(missing).toEqual([]);
  });

  it('nothing is both exported and listed as not exported (the list cannot go stale)', () => {
    const stale = Object.keys(NOT_EXPORTED).filter((model) => new RegExp(`prisma\\.${model}\\.`).test(exportSection));
    expect(stale).toEqual([]);
  });

  it('every column of the user row is exported or deliberately withheld', () => {
    const user = modelBlocks().find((m) => m.name === 'User')!.body;
    const scalars = user
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^\w+\s+(String|Int|Boolean|DateTime|Decimal|Float|Json|BigInt)\b/.test(line))
      .map((line) => line.split(/\s+/)[0]);
    const profileSelect = privacy.slice(privacy.indexOf('const PROFILE_SELECT'), privacy.indexOf('export interface DeleteAccountInput'));
    const WITHHELD: Record<string, string> = {
      passwordHash: 'credential',
      tokenVersion: 'session counter, not data about the person',
      updatedAt: 'bookkeeping',
      profileCompleteness: 'derived score',
      emailVerifiedAt: 'verification bookkeeping, shown as isVerified',
      approvalReviewedById: 'the reviewer\'s id (another person); the outcome and the note are exported',
      membershipTierId: 'exported through memberships',
      isActive: 'account state',
      verifiedAt: 'bookkeeping',
    };
    const missing = scalars.filter((field) => !new RegExp(`\\b${field}:\\s*true`).test(profileSelect) && !(field in WITHHELD));
    expect(missing).toEqual([]);
  });
});

describe('R3-H3 behaviour: what is exported is the member\'s, and deletion leaves nothing that identifies them', () => {
  it('the export carries the member\'s own rows and none of anybody else\'s, no password hash, no token, no invite token, no gateway signature', async () => {
    const me = await createUser('MEMBER', { enrollmentNumber: 'ENR-R3-1', verificationNote: 'my note' });
    const other = await createUser('MEMBER');
    await prisma.post.create({ data: { userId: me.user.id, content: 'my own post' } });
    await prisma.post.create({ data: { userId: other.user.id, content: 'somebody else\'s post' } });
    await prisma.notification.create({ data: { userId: other.user.id, type: 'ADMIN_ANNOUNCEMENT', title: 'not mine', message: 'x' } });
    const seen = await prisma.post.create({ data: { userId: other.user.id, content: 'a post I opened' } });
    await prisma.postImpression.create({ data: { postId: seen.id, userId: me.user.id } });

    const res = await http().get('/api/users/me/export').set('Authorization', me.auth);
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).toContain('my own post');
    expect(text).toContain('ENR-R3-1');
    expect(res.body.data.postViews.map((v: { postId: string }) => v.postId)).toEqual([seen.id]); // the reading history is the member's data too
    expect(res.body.data.profile).toHaveProperty('isNotable');
    expect(text).not.toContain("somebody else's post");
    expect(text).not.toContain('not mine');
    expect(text).not.toContain(me.user.passwordHash);
    expect(text).not.toMatch(/passwordHash|gatewaySignature|"token":|refreshToken|tokenVersion/);
  });

  it('after deletion no row of any table still carries the member\'s e-mail address or name (the kept records are anonymised)', async () => {
    const me = await createUser('MEMBER', { fullName: 'Residue Checker R3', phoneNumber: '+91 98765 43210', city: 'Pune R3' });
    const other = await createUser('MEMBER');
    await prisma.post.create({ data: { userId: me.user.id, content: 'kept but anonymised' } });
    await prisma.message.create({ data: { senderId: me.user.id, receiverId: other.user.id, content: 'hello' } });
    await prisma.invite.create({ data: { inviterId: me.user.id, email: 'invitee-r3@example.com', token: `r3-${Date.now()}-a`, expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.auditLog.create({ data: { userId: me.user.id, action: 'LOGIN', entityType: 'USER', entityId: me.user.id, ipAddress: '203.0.113.9', userAgent: 'R3' } });

    const login = await http().post('/api/auth/login').send({ email: me.user.email, password: PASSWORD });
    const del = await http().delete('/api/users/me').set('Authorization', `Bearer ${login.body.data.accessToken}`).send({ password: PASSWORD });
    expect(del.status).toBe(200);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: me.user.id } });
    const json = JSON.stringify(row);
    for (const secret of [me.user.email, 'Residue Checker R3', '98765', 'Pune R3']) expect({ secret, found: json.includes(secret) }).toEqual({ secret, found: false });
    expect(row.passwordHash ?? '').toBe('');
    expect(await prisma.invite.count({ where: { inviterId: me.user.id } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: me.user.id } })).toBe(0);
    expect(await prisma.verificationToken.count({ where: { userId: me.user.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: me.user.id } })).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { userId: me.user.id } });
    expect(audit.filter((a) => a.ipAddress || a.userAgent)).toEqual([]);
  });
});
