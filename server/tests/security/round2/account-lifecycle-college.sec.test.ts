/**
 * Account deletion and data export for the college features (videos, requirements, referrals, home/work locations).
 *
 * Deleting an account anonymises the user row in place, so database cascades never run: every table that holds a
 * member's personal data needs an explicit rule. The schema scan in account-lifecycle.sec.test.ts forces that decision
 * for a new model; these tests check the decisions that were taken.
 */
import { createUser, http, prisma, PASSWORD } from '../../integration/helpers';

afterAll(async () => {
  await prisma.$disconnect();
});

const deleteAccount = async (email: string) => {
  const login = await http().post('/api/auth/login').send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  const res = await http().delete('/api/users/me').set('Authorization', `Bearer ${login.body.data.accessToken}`).send({ password: PASSWORD });
  expect(res.status).toBe(200);
};

describe('precise locations are personal data', () => {
  it('account deletion clears home and work coordinates and the work city, not just the map pin', async () => {
    const { user } = await createUser('MEMBER', {
      locationLat: 15.5, locationLng: 73.8, homeLat: 15.4991, homeLng: 73.8279, workLat: 15.5, workLng: 73.83, workCity: 'Panaji', city: 'Margao',
    });

    await deleteAccount(user.email);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect([row.locationLat, row.locationLng, row.homeLat, row.homeLng, row.workLat, row.workLng]).toEqual([null, null, null, null, null, null]);
    expect(row.workCity).toBeNull();
    expect(row.city).toBeNull();
  });

  it('the data export includes them (the member may take them with them)', async () => {
    const me = await createUser('MEMBER', { homeLat: 15.4991, homeLng: 73.8279, workCity: 'Panaji exporter' });
    const res = await http().get('/api/users/me/export').set('Authorization', me.auth);
    expect(res.status).toBe(200);
    expect(res.body.data.profile).toMatchObject({ workCity: 'Panaji exporter' });
    expect(Number(res.body.data.profile.homeLat)).toBeCloseTo(15.4991, 3);
  });
});

describe('what a member sent through the college features', () => {
  const setup = async () => {
    const member = await createUser('MEMBER');
    const other = await createUser('MEMBER');
    const admin = await createUser('ADMIN');
    const requirement = await prisma.collegeRequirement.create({
      data: { title: 'Lab laptops', description: 'We need laptops', postedById: admin.user.id },
    });
    const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    return { member, other, admin, requirement, tag };
  };

  it('deletion removes their referral requests in both directions, their requirement offers and their unpublished videos', async () => {
    const { member, other, requirement, tag } = await setup();
    await prisma.referralRequest.create({ data: { requesterId: member.user.id, targetId: other.user.id, company: 'Acme', message: `please refer me ${tag}` } });
    await prisma.referralRequest.create({ data: { requesterId: other.user.id, targetId: member.user.id, company: 'Globex', message: `asking the member ${tag}` } });
    await prisma.requirementResponse.create({ data: { requirementId: requirement.id, userId: member.user.id, message: `I can donate ${tag}` } });
    await prisma.collegeVideo.createMany({
      data: [
        { title: 'pending', videoUrl: `/uploads/college-videos/${tag}-p.mp4`, submittedById: member.user.id, status: 'PENDING' },
        { title: 'rejected', videoUrl: `/uploads/college-videos/${tag}-r.mp4`, submittedById: member.user.id, status: 'REJECTED' },
        { title: 'published', videoUrl: `/uploads/college-videos/${tag}-a.mp4`, submittedById: member.user.id, status: 'APPROVED' },
      ],
    });

    await deleteAccount(member.user.email);

    expect(await prisma.referralRequest.count({ where: { OR: [{ requesterId: member.user.id }, { targetId: member.user.id }] } })).toBe(0);
    expect(await prisma.requirementResponse.count({ where: { userId: member.user.id } })).toBe(0);
    const videos = await prisma.collegeVideo.findMany({ where: { submittedById: member.user.id } });
    // submissions that never went public are gone; the one the college published stays (attributed to "Deleted User")
    expect(videos.map((v) => v.title)).toEqual(['published']);
  });

  it('does not touch other people\'s requests, offers or videos', async () => {
    const { member, other, requirement, tag } = await setup();
    const third = await createUser('MEMBER');
    await prisma.referralRequest.create({ data: { requesterId: other.user.id, targetId: third.user.id, company: 'Initech', message: `unrelated ${tag}` } });
    await prisma.requirementResponse.create({ data: { requirementId: requirement.id, userId: other.user.id, message: `my offer ${tag}` } });
    await prisma.collegeVideo.create({ data: { title: 'someone else', videoUrl: `/uploads/college-videos/${tag}-o.mp4`, submittedById: other.user.id, status: 'PENDING' } });

    await deleteAccount(member.user.email);

    expect(await prisma.referralRequest.count({ where: { requesterId: other.user.id } })).toBe(1);
    expect(await prisma.requirementResponse.count({ where: { userId: other.user.id } })).toBe(1);
    expect(await prisma.collegeVideo.count({ where: { submittedById: other.user.id } })).toBe(1);
  });

  it('the data export includes them, and nothing that belongs to somebody else', async () => {
    const { member, other, requirement, tag } = await setup();
    await prisma.referralRequest.create({ data: { requesterId: member.user.id, targetId: other.user.id, company: 'Acme', message: `export me ${tag}` } });
    await prisma.requirementResponse.create({ data: { requirementId: requirement.id, userId: member.user.id, message: `my offer export ${tag}` } });
    await prisma.collegeVideo.create({ data: { title: `my video ${tag}`, videoUrl: `/uploads/college-videos/${tag}-e.mp4`, submittedById: member.user.id } });
    await prisma.collegeVideo.create({ data: { title: `not mine ${tag}`, videoUrl: `/uploads/college-videos/${tag}-n.mp4`, submittedById: other.user.id } });

    const res = await http().get('/api/users/me/export').set('Authorization', member.auth);
    expect(res.status).toBe(200);
    const dump = JSON.stringify(res.body.data);
    expect(dump).toContain(`export me ${tag}`);
    expect(dump).toContain(`my offer export ${tag}`);
    expect(dump).toContain(`my video ${tag}`);
    expect(dump).not.toContain(`not mine ${tag}`);
  });
});
