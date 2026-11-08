/**
 * AUTHZ security suite: mass assignment / parameter pollution.
 *
 * Each test asserts the SECURE behaviour. A failing test here is a confirmed
 * vulnerability; a passing test documents a control that is correctly enforced.
 */
import { createUser, http, prisma, uniqueEmail, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('AUTHZ: mass assignment on create/update bodies', () => {
  it('registration ignores client-supplied userRole/isVerified/isActive/tokenVersion', async () => {
    const email = uniqueEmail('massassign');
    const res = await http().post('/api/auth/register').send({
      email,
      password: PASSWORD,
      fullName: 'Probe User',
      batchYear: 2020,
      department: 'CS',
      degree: 'BE',
      userRole: 'SUPER_ADMIN',
      isVerified: true,
      isActive: false,
      tokenVersion: 99,
    });
    expect(res.status).toBe(201);

    const created = await prisma.user.findUnique({ where: { email } });
    expect(created!.userRole).toBe('MEMBER');
    expect(created!.isVerified).toBe(false);
    expect(created!.isActive).toBe(true);
    expect(created!.tokenVersion).toBe(0);
  });

  it('profile update ignores userRole/isVerified/isActive/email/tokenVersion', async () => {
    const member = await createUser('MEMBER');
    const res = await http().patch('/api/users/profile').set('Authorization', member.auth).send({
      fullName: 'Still Me',
      userRole: 'SUPER_ADMIN',
      isVerified: false,
      isActive: false,
      email: 'pwned@evil.com',
      tokenVersion: 999,
      id: '00000000-0000-4000-8000-00000000dead',
    });
    expect(res.status).toBe(200);

    const after = await prisma.user.findUnique({ where: { id: member.user.id } });
    expect(after!.userRole).toBe('MEMBER');
    expect(after!.isVerified).toBe(true);
    expect(after!.isActive).toBe(true);
    expect(after!.email).toBe(member.user.email);
  });

  it('a __proto__ key in a JSON body does not pollute the global Object prototype', async () => {
    const member = await createUser('MEMBER');
    const res = await http()
      .patch('/api/users/profile')
      .set('Authorization', member.auth)
      .send(JSON.parse('{"__proto__": {"polluted": true}, "fullName": "Clean"}'));
    expect(res.status).toBe(200);
    expect(({} as any).polluted).toBeUndefined();
  });

  it('only an admin may set isPinned on a post, even when the owner sends it', async () => {
    const owner = await createUser('MEMBER');
    const post = await http().post('/api/posts').set('Authorization', owner.auth).send({ content: 'pin me?' });
    const id = post.body.data.id;

    const res = await http().patch(`/api/posts/${id}`).set('Authorization', owner.auth).send({ content: 'pin me? (edited)', isPinned: true });
    expect(res.status).toBe(200);
    expect(res.body.data.isPinned).toBe(false);
  });

  it('chapter member/counter fields cannot be mass-assigned through the update endpoint', async () => {
    const admin = await createUser('ADMIN');
    const chapterAdminUser = await createUser('MEMBER');
    const chapter = await prisma.chapter.create({ data: { name: `Chapter ${Date.now()}`, region: 'West' } });
    await http().put(`/api/chapters/${chapter.id}/admin`).set('Authorization', admin.auth).send({ userId: chapterAdminUser.user.id });

    const res = await http()
      .patch(`/api/chapters/${chapter.id}`)
      .set('Authorization', chapterAdminUser.auth)
      .send({ description: 'ok', memberCount: 999999, adminUserId: '00000000-0000-4000-8000-00000000dead', isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.memberCount).toBe(0);
    expect(res.body.data.adminUserId).toBe(chapterAdminUser.user.id);
    expect(res.body.data.isActive).toBe(true);
  });

  it('event rsvpCount/createdById cannot be mass-assigned through the update endpoint', async () => {
    const admin = await createUser('ADMIN');
    const event = await prisma.event.create({
      data: {
        title: 'E', description: 'd', startDate: new Date(Date.now() + 86400000), createdById: admin.user.id, status: 'PUBLISHED',
      },
    });
    const other = await createUser('MEMBER');

    const res = await http()
      .patch(`/api/events/${event.id}`)
      .set('Authorization', admin.auth)
      .send({ title: 'E (edited)', rsvpCount: 50000, createdById: other.user.id, id: '00000000-0000-4000-8000-00000000dead' });
    expect(res.status).toBe(200);
    expect(res.body.data.rsvpCount).toBe(0);
    expect(res.body.data.createdById).toBe(admin.user.id);
  });

  it('job postedById/status/isFeatured cannot be mass-assigned by a regular member', async () => {
    const owner = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const job = await prisma.jobOpportunity.create({
      data: { title: 'T', description: 'd', company: 'C', postedById: owner.user.id, status: 'PENDING_REVIEW' },
    });

    const res = await http()
      .patch(`/api/jobs/${job.id}`)
      .set('Authorization', owner.auth)
      .send({ title: 'T (edited)', status: 'PUBLISHED', isFeatured: true, postedById: other.user.id, viewCount: 99999 });
    expect(res.status).toBe(200);
    const after = await prisma.jobOpportunity.findUnique({ where: { id: job.id } });
    expect(after!.status).toBe('PENDING_REVIEW');
    expect(after!.isFeatured).toBe(false);
    expect(after!.postedById).toBe(owner.user.id);
    expect(after!.viewCount).toBe(0);
  });
});
