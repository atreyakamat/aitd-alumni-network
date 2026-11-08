/**
 * Round trips: send EVERY field the client can send to a write route and read the row back from the
 * database. zod strips unknown keys and services whitelist fields, so a field that is missing from either
 * is silently dropped (the createPostSchema bug class); only reading the stored row proves it survived.
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

const send = (method: 'post' | 'patch' | 'put', path: string, as: keyof Users, body: unknown) =>
  (request(app) as any)[method](`/api${path}`).set('Authorization', u[as].auth).send(body);

const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

describe('profile', () => {
  it('PATCH /users/profile keeps every editable field', async () => {
    const who = await fx.newUser();
    const body = {
      fullName: 'Round Trip',
      currentDesignation: 'Staff Engineer',
      shortBio: 'Bio text',
      city: 'Pune',
      hometown: 'Nashik',
      locationLat: 18.52,
      locationLng: 73.86,
      isLocationPublic: true,
      phoneNumber: '+91 98765 43210',
      phoneVisibility: 'CONNECTIONS',
      linkedinUrl: 'https://linkedin.com/in/rt',
      twitterUrl: 'https://twitter.com/rt',
      githubUrl: 'https://github.com/rt',
      websiteUrl: 'https://rt.example.com',
      secondaryEmail: 'rt@example.com',
    };
    const res = await (request(app) as any).patch('/api/users/profile').set('Authorization', who.auth).send(body);
    expect(res.status).toBe(200);
    const row: any = await fx.prisma.user.findUniqueOrThrow({ where: { id: who.user.id } });
    const { locationLat, locationLng, ...plain } = body;
    expect(row).toMatchObject(plain);
    expect(Number(row.locationLat)).toBeCloseTo(locationLat, 1);
    expect(Number(row.locationLng)).toBeCloseTo(locationLng, 1);
  });

  it('work experience and education keep every field on create and on edit', async () => {
    const work = await send('post', '/users/work-experience', 'member', {
      company: 'Acme',
      role: 'Engineer',
      location: 'Pune',
      startDate: '2020-01-01',
      endDate: '2022-06-01',
      isCurrent: false,
      description: 'Built things',
    });
    expect(work.status).toBe(201);
    const workRow = await fx.prisma.workExperience.findUniqueOrThrow({ where: { id: work.body.data.id } });
    expect(workRow).toMatchObject({ company: 'Acme', role: 'Engineer', location: 'Pune', description: 'Built things', isCurrent: false });
    expect(workRow.endDate?.toISOString().slice(0, 10)).toBe('2022-06-01');

    const edited = await send('patch', `/users/work-experience/${workRow.id}`, 'member', {
      company: 'Beta',
      role: 'Lead',
      location: 'Mumbai',
      startDate: '2021-02-01',
      endDate: null,
      isCurrent: true,
      description: 'Led things',
    });
    expect(edited.status).toBe(200);
    expect(await fx.prisma.workExperience.findUniqueOrThrow({ where: { id: workRow.id } })).toMatchObject({
      company: 'Beta',
      role: 'Lead',
      location: 'Mumbai',
      description: 'Led things',
      isCurrent: true,
      endDate: null,
    });

    const edu = await send('post', '/users/education', 'member', {
      institution: 'AITD',
      degree: 'B.E.',
      fieldOfStudy: 'Computer',
      startYear: 2014,
      endYear: 2018,
      grade: 'A',
      description: 'Studied',
      isPrimary: true,
    });
    expect(edu.status).toBe(201);
    const eduRow = await fx.prisma.education.findUniqueOrThrow({ where: { id: edu.body.data.id } });
    expect(eduRow).toMatchObject({ institution: 'AITD', degree: 'B.E.', fieldOfStudy: 'Computer', startYear: 2014, endYear: 2018, grade: 'A', description: 'Studied', isPrimary: true });

    const editedEdu = await send('patch', `/users/education/${eduRow.id}`, 'member', {
      institution: 'MIT',
      degree: 'M.S.',
      fieldOfStudy: 'AI',
      startYear: 2019,
      endYear: null,
      grade: 'A+',
      description: 'More',
      isPrimary: false,
    });
    expect(editedEdu.status).toBe(200);
    expect(await fx.prisma.education.findUniqueOrThrow({ where: { id: eduRow.id } })).toMatchObject({
      institution: 'MIT',
      degree: 'M.S.',
      fieldOfStudy: 'AI',
      startYear: 2019,
      endYear: null,
      grade: 'A+',
      description: 'More',
      isPrimary: false,
    });
  });
});

describe('jobs', () => {
  it('POST and PATCH /jobs keep every field', async () => {
    const body = {
      title: 'Round Trip Engineer',
      company: 'RT Co',
      description: 'Do the thing',
      location: 'Pune',
      workplaceType: 'HYBRID',
      jobType: 'CONTRACT',
      industry: 'Software',
      salaryMin: 1000,
      salaryMax: 2000,
      experienceMin: 1,
      experienceMax: 5,
      skills: ['TypeScript', 'SQL'],
      applicationLink: 'https://example.com/apply',
      deadline: iso(30),
    };
    const created = await send('post', '/jobs', 'member', body);
    expect(created.status).toBe(201);
    const row = await fx.prisma.jobOpportunity.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(row).toMatchObject({
      title: body.title,
      company: body.company,
      description: body.description,
      location: 'Pune',
      workplaceType: 'HYBRID',
      jobType: 'CONTRACT',
      industry: 'Software',
      experienceMin: 1,
      experienceMax: 5,
      skills: ['TypeScript', 'SQL'],
      applicationLink: body.applicationLink,
    });
    expect(Number(row.salaryMin)).toBe(1000);
    expect(Number(row.salaryMax)).toBe(2000);
    expect(row.deadline?.toISOString()).toBe(body.deadline);

    const patch = {
      title: 'Edited',
      company: 'Edited Co',
      description: 'Edited body',
      location: 'Mumbai',
      workplaceType: 'REMOTE',
      jobType: 'PART_TIME',
      industry: 'Finance',
      salaryMin: 10,
      salaryMax: 20,
      experienceMin: 2,
      experienceMax: 6,
      skills: ['Go'],
      applicationLink: 'https://example.com/other',
      deadline: iso(40),
    };
    const edited = await send('patch', `/jobs/${row.id}`, 'member', patch);
    expect(edited.status).toBe(200);
    const after = await fx.prisma.jobOpportunity.findUniqueOrThrow({ where: { id: row.id } });
    const { salaryMin, salaryMax, deadline, ...plain } = patch;
    expect(after).toMatchObject(plain);
    expect([Number(after.salaryMin), Number(after.salaryMax)]).toEqual([salaryMin, salaryMax]);
    expect(after.deadline?.toISOString()).toBe(deadline);
  });
});

describe('events', () => {
  it('POST and PATCH /events keep every field', async () => {
    const chapter = await fx.newChapter(u.chapterAdmin.user.id);
    const body = {
      title: 'RT Meetup',
      description: 'Come',
      bannerUrl: '/uploads/events/banner.png',
      eventType: 'HYBRID',
      venue: 'Hall 1',
      address: '1 Main Rd',
      city: 'Pune',
      joinLink: 'https://meet.example.com/rt',
      startDate: iso(10),
      endDate: iso(11),
      capacity: 50,
      tags: ['networking', 'tech'],
      isPublic: false,
      chapterId: chapter.id,
    };
    const created = await send('post', '/events', 'admin', body);
    expect(created.status).toBe(201);
    const row = await fx.prisma.event.findUniqueOrThrow({ where: { id: created.body.data.id } });
    const { startDate, endDate, ...plain } = body;
    expect(row).toMatchObject(plain);
    expect(row.startDate.toISOString()).toBe(startDate);
    expect(row.endDate?.toISOString()).toBe(endDate);

    const patch = {
      title: 'RT Meetup 2',
      description: 'Come again',
      bannerUrl: '/uploads/events/banner2.png',
      eventType: 'ONLINE',
      venue: 'Hall 2',
      address: '2 Main Rd',
      city: 'Mumbai',
      joinLink: 'https://meet.example.com/rt2',
      startDate: iso(20),
      endDate: iso(21),
      capacity: 80,
      tags: ['x'],
      isPublic: true,
    };
    const edited = await send('patch', `/events/${row.id}`, 'admin', patch);
    expect(edited.status).toBe(200);
    const after = await fx.prisma.event.findUniqueOrThrow({ where: { id: row.id } });
    const { startDate: s2, endDate: e2, ...plain2 } = patch;
    expect(after).toMatchObject(plain2);
    expect(after.startDate.toISOString()).toBe(s2);
    expect(after.endDate?.toISOString()).toBe(e2);
  });
});

describe('marketplace', () => {
  it('POST and PATCH /marketplace keep every field', async () => {
    const body = {
      type: 'REQUIREMENT',
      title: 'RT Listing',
      category: 'Consulting',
      description: 'A description that is long enough',
      location: 'Pune',
      website: 'https://example.com',
      contactInfo: 'hi@example.com',
      priceRange: 'INR 500-2,000',
    };
    const created = await send('post', '/marketplace', 'member', body);
    expect(created.status).toBe(201);
    const row = await fx.prisma.marketplaceListing.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(row).toMatchObject(body);

    const patch = {
      type: 'SERVICE',
      title: 'RT Listing 2',
      category: 'Design',
      description: 'Another description that is long enough',
      location: 'Mumbai',
      website: 'https://example.org',
      contactInfo: 'x@example.com',
      priceRange: 'Free',
      isActive: false,
    };
    const edited = await send('patch', `/marketplace/${row.id}`, 'member', patch);
    expect(edited.status).toBe(200);
    expect(await fx.prisma.marketplaceListing.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject(patch);

    // Admin-only moderation field
    const featured = await send('patch', `/marketplace/${row.id}`, 'admin', { isFeatured: true });
    expect(featured.status).toBe(200);
    expect((await fx.prisma.marketplaceListing.findUniqueOrThrow({ where: { id: row.id } })).isFeatured).toBe(true);
  });
});

describe('gallery, news and chapters', () => {
  it('album create and edit keep every field', async () => {
    const event = await fx.newEvent(u.admin.user.id);
    const created = await send('post', '/gallery/albums', 'admin', {
      title: 'RT Album',
      description: 'Photos',
      albumType: 'EVENT',
      eventId: event.id,
      isPublic: false,
    });
    expect(created.status).toBe(201);
    expect(await fx.prisma.galleryAlbum.findUniqueOrThrow({ where: { id: created.body.data.id } })).toMatchObject({
      title: 'RT Album',
      description: 'Photos',
      albumType: 'EVENT',
      eventId: event.id,
      isPublic: false,
    });

    const batch = await send('post', '/gallery/albums', 'admin', { title: 'RT Batch', albumType: 'BATCH', batchYear: 2015 });
    expect(batch.status).toBe(201);
    expect(batch.body.data.batchYear).toBe(2015);

    const edited = await send('patch', `/gallery/albums/${batch.body.data.id}`, 'admin', {
      title: 'RT Batch 2',
      description: 'd',
      albumType: 'INSTITUTIONAL',
      batchYear: null,
      eventId: null,
      isPublic: false,
      coverPhotoUrl: '/uploads/gallery/c.png',
    });
    expect(edited.status).toBe(200);
    expect(await fx.prisma.galleryAlbum.findUniqueOrThrow({ where: { id: batch.body.data.id } })).toMatchObject({
      title: 'RT Batch 2',
      description: 'd',
      albumType: 'INSTITUTIONAL',
      batchYear: null,
      eventId: null,
      isPublic: false,
      coverPhotoUrl: '/uploads/gallery/c.png',
    });
  });

  it('news create and edit keep every field', async () => {
    const created = await send('post', '/news', 'admin', {
      title: 'RT Story',
      content: 'Body text. '.repeat(30),
      excerpt: 'Custom excerpt',
      category: 'ALUMNI_STORY',
      featuredImage: '/uploads/news/f.png',
    });
    expect(created.status).toBe(201);
    expect(await fx.prisma.newsArticle.findUniqueOrThrow({ where: { id: created.body.data.id } })).toMatchObject({
      title: 'RT Story',
      excerpt: 'Custom excerpt',
      category: 'ALUMNI_STORY',
      featuredImage: '/uploads/news/f.png',
    });
    const edited = await send('patch', `/news/${created.body.data.id}`, 'admin', {
      title: 'RT Story 2',
      content: 'New body. '.repeat(30),
      excerpt: 'New excerpt',
      category: 'NEWSLETTER',
      featuredImage: null,
    });
    expect(edited.status).toBe(200);
    expect(await fx.prisma.newsArticle.findUniqueOrThrow({ where: { id: created.body.data.id } })).toMatchObject({
      title: 'RT Story 2',
      excerpt: 'New excerpt',
      category: 'NEWSLETTER',
      featuredImage: null,
    });
  });

  it('chapter create and edit keep every field', async () => {
    const name = fx.uniq('RT Chapter');
    const created = await send('post', '/chapters', 'admin', {
      name,
      region: 'Delhi',
      description: 'A chapter',
      logoUrl: '/uploads/chapters/l.png',
      adminUserId: u.chapterAdmin.user.id,
    });
    expect(created.status).toBe(201);
    expect(await fx.prisma.chapter.findUniqueOrThrow({ where: { id: created.body.data.id } })).toMatchObject({
      name,
      region: 'Delhi',
      description: 'A chapter',
      logoUrl: '/uploads/chapters/l.png',
      adminUserId: u.chapterAdmin.user.id,
    });
    const edited = await send('patch', `/chapters/${created.body.data.id}`, 'admin', {
      name: `${name} 2`,
      region: 'Goa',
      description: 'Edited',
      logoUrl: '/uploads/chapters/l2.png',
    });
    expect(edited.status).toBe(200);
    expect(await fx.prisma.chapter.findUniqueOrThrow({ where: { id: created.body.data.id } })).toMatchObject({
      name: `${name} 2`,
      region: 'Goa',
      description: 'Edited',
      logoUrl: '/uploads/chapters/l2.png',
    });
  });
});

describe('mentorship', () => {
  it('mentor profile create and edit keep every field', async () => {
    const mentor = await fx.newUser();
    const created = await (request(app) as any)
      .post('/api/mentorship/profile')
      .set('Authorization', mentor.auth)
      .send({ focusAreas: ['Careers', 'Startups'], availability: 'Weekends', bio: 'I help', maxMentees: 3 });
    expect(created.status).toBe(201);
    expect(await fx.prisma.mentorProfile.findUniqueOrThrow({ where: { userId: mentor.user.id } })).toMatchObject({
      focusAreas: ['Careers', 'Startups'],
      availability: 'Weekends',
      bio: 'I help',
      maxMentees: 3,
    });
    const edited = await (request(app) as any)
      .patch('/api/mentorship/profile')
      .set('Authorization', mentor.auth)
      .send({ focusAreas: ['Design'], availability: 'Evenings', bio: 'Updated', maxMentees: 4, isActive: false });
    expect(edited.status).toBe(200);
    expect(await fx.prisma.mentorProfile.findUniqueOrThrow({ where: { userId: mentor.user.id } })).toMatchObject({
      focusAreas: ['Design'],
      availability: 'Evenings',
      bio: 'Updated',
      maxMentees: 4,
      isActive: false,
    });
  });

  it('a mentorship request keeps the mentee message and a session keeps its notes', async () => {
    const mentor = await fx.newUser();
    await fx.newMentor(mentor.user.id);
    const requested = await send('post', `/mentorship/request/${mentor.user.id}`, 'member', { message: 'Please mentor me' });
    expect(requested.status).toBe(201);
    expect((await fx.prisma.mentorshipRequest.findUniqueOrThrow({ where: { id: requested.body.data.id } })).message).toBe('Please mentor me');

    const accepted = await (request(app) as any)
      .post(`/api/mentorship/request/${requested.body.data.id}/respond`)
      .set('Authorization', mentor.auth)
      .send({ accept: true });
    expect(accepted.status).toBe(200);

    const scheduledAt = iso(5);
    const session = await (request(app) as any)
      .post(`/api/mentorship/request/${requested.body.data.id}/sessions`)
      .set('Authorization', mentor.auth)
      .send({ scheduledAt, notes: 'Agenda' });
    expect(session.status).toBe(201);
    const row = await fx.prisma.mentorshipSession.findUniqueOrThrow({ where: { id: session.body.data.id } });
    expect(row.notes).toBe('Agenda');
    expect(row.scheduledAt.toISOString()).toBe(scheduledAt);

    const done = await (request(app) as any)
      .post(`/api/mentorship/sessions/${row.id}/complete`)
      .set('Authorization', mentor.auth)
      .send({ outcomes: 'Went well' });
    expect(done.status).toBe(200);
    expect((await fx.prisma.mentorshipSession.findUniqueOrThrow({ where: { id: row.id } })).outcomes).toBe('Went well');
  });
});

describe('invites and messages', () => {
  it('an invite keeps the name, batch year and message', async () => {
    const address = fx.uniqueEmail('rt-invitee');
    const sent = await send('post', '/invites/send', 'member', { email: address, name: 'Invitee RT', batchYear: 2017, message: 'Join us' });
    expect(sent.status).toBe(201);
    const row = await fx.prisma.invite.findFirstOrThrow({ where: { email: address } });
    expect(row).toMatchObject({ name: 'Invitee RT', batchYear: 2017 });
    expect(JSON.stringify(row.metadata)).toContain('Join us');
  });

  it('a message keeps its text and media', async () => {
    const sent = await send('post', `/messages/${u.other.user.id}`, 'member', { content: 'Hello RT', mediaUrl: '/uploads/messages/pic.png' });
    expect(sent.status).toBe(201);
    expect(await fx.prisma.message.findUniqueOrThrow({ where: { id: sent.body.data.id } })).toMatchObject({
      content: 'Hello RT',
      mediaUrl: '/uploads/messages/pic.png',
    });
  });
});
