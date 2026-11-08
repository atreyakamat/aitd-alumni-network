/**
 * The response fields the Next.js client reads, per endpoint. These pin the SERVER side of contracts the
 * client adapts to (client/src/lib/people.ts and the pages that read these payloads): when a field is
 * renamed here the matching client test and page must change with it.
 */
import request from 'supertest';
import { app } from '../integration/helpers';
import * as fx from './fixtures';
import type { Users } from './fixtures';

let u: Users;
let tag: string;

beforeAll(async () => {
  u = await fx.makeUsers();
  tag = `Shape${Date.now().toString(36)}`;
  await fx.prisma.user.update({
    where: { id: u.other.user.id },
    data: { fullName: `${tag} Other`, currentDesignation: 'Staff Engineer', city: 'Pune', department: 'Civil', batchYear: 2011 },
  });
  await fx.newMessage(u.other.user.id, u.member.user.id);
  await fx.newConnection(u.third.user.id, u.member.user.id, 'PENDING');
  await fx.newConnection(u.member.user.id, (await fx.newUser()).user.id, 'PENDING');
  await fx.newMentor(u.other.user.id);
}, 60000);

afterAll(async () => {
  await fx.prisma.$disconnect();
});

const get = (path: string, as: keyof Users = 'member') => request(app).get(`/api${path}`).set('Authorization', u[as].auth);

const PERSON = {
  id: expect.any(String),
  fullName: expect.any(String),
  profilePhotoUrl: null,
  department: expect.any(String),
};

describe('people payloads', () => {
  it('GET /users/directory: { data: [person], pagination } (the old { items, pages } shape is gone)', async () => {
    const res = await get('/users/directory').query({ search: tag });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('items');
    expect(res.body.pagination).toEqual(expect.objectContaining({ total: 1, page: 1, totalPages: 1 }));
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({
        ...PERSON,
        fullName: `${tag} Other`,
        batchYear: 2011,
        department: 'Civil',
        currentDesignation: 'Staff Engineer',
        city: 'Pune',
      })
    );
    // The names the client used to read do not exist
    for (const stale of ['avatarUrl', 'headline', 'locationCity', 'locationCountry']) expect(res.body.data[0]).not.toHaveProperty(stale);
  });

  it('GET /users/yearbook/:year: { data: { alumni: [person] } }', async () => {
    const res = await get('/users/yearbook/2011');
    expect(res.status).toBe(200);
    const mine = res.body.data.alumni.find((p: any) => p.id === u.other.user.id);
    expect(mine).toEqual(expect.objectContaining({ fullName: `${tag} Other`, department: 'Civil', currentDesignation: 'Staff Engineer', city: 'Pune' }));
  });

  it('GET /network/connections: the other user flattened, plus the connection id', async () => {
    const res = await get('/network/connections');
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    const row = res.body.data.find((c: any) => c.id === u.other.user.id);
    expect(row).toEqual(
      expect.objectContaining({ connectionId: expect.any(String), id: u.other.user.id, fullName: `${tag} Other`, currentDesignation: 'Staff Engineer' })
    );
  });

  it('GET /network/requests: { received: [{ connectionId, user }], sent: [...] }', async () => {
    const res = await get('/network/requests');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(false);
    expect(res.body.data.received[0]).toEqual(
      expect.objectContaining({ connectionId: expect.any(String), user: expect.objectContaining({ id: u.third.user.id, fullName: expect.any(String) }) })
    );
    expect(res.body.data.sent).toHaveLength(1);
    expect(res.body.data.sent[0].user.id).toEqual(expect.any(String));
  });

  it('POST /network/respond/:id takes the connectionId from /network/requests', async () => {
    const pending = await get('/network/requests');
    const { connectionId } = pending.body.data.received[0];
    const res = await request(app).post(`/api/network/respond/${connectionId}`).set('Authorization', u.member.auth).send({ accept: true });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACCEPTED');
  });
});

describe('messages', () => {
  it('GET /messages: conversations carry the partner, the last message and the unread count', async () => {
    const res = await get('/messages');
    expect(res.status).toBe(200);
    const conv = res.body.data.find((c: any) => c.partner.id === u.other.user.id);
    expect(conv).toEqual(
      expect.objectContaining({
        partnerId: u.other.user.id,
        unreadCount: 1,
        partner: expect.objectContaining({ id: u.other.user.id, fullName: `${tag} Other` }),
        // Sent-by-me is `isSent`; there is no senderId on lastMessage
        lastMessage: expect.objectContaining({ content: 'Contract message', createdAt: expect.any(String), isSent: false }),
      })
    );
    expect(conv.lastMessage).not.toHaveProperty('senderId');
  });

  it('GET /messages/:partnerId: messages carry senderId, content and createdAt', async () => {
    const res = await get(`/messages/${u.other.user.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual(expect.objectContaining({ id: expect.any(String), senderId: u.other.user.id, content: 'Contract message', createdAt: expect.any(String) }));
  });
});

describe('mentorship', () => {
  it('GET /mentorship/mentors: { data: { data: [mentor], pagination } } (nested; the page reads data.data.data)', async () => {
    const res = await get('/mentorship/mentors', 'third');
    expect(res.status).toBe(200);
    const mentor = res.body.data.data.find((m: any) => m.user.id === u.other.user.id);
    expect(mentor).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        focusAreas: expect.any(Array),
        currentMentees: expect.any(Number),
        maxMentees: expect.any(Number),
        user: expect.objectContaining({ id: u.other.user.id, fullName: expect.any(String), department: expect.any(String), batchYear: expect.any(Number) }),
      })
    );
  });

  it('GET /mentorship/requests/{mentor,mentee} include the other party', async () => {
    const mentor = await fx.newUser();
    const mentee = await fx.newUser();
    const request1 = await fx.newMentorshipRequest(mentee.user.id, mentor.user.id, 'PENDING');
    const asMentor = await request(app).get('/api/mentorship/requests/mentor').set('Authorization', mentor.auth);
    const asMentee = await request(app).get('/api/mentorship/requests/mentee').set('Authorization', mentee.auth);
    expect(asMentor.body.data.find((r: any) => r.id === request1.id).mentee).toEqual(
      expect.objectContaining({ id: mentee.user.id, fullName: expect.any(String), department: expect.any(String), batchYear: expect.any(Number) })
    );
    expect(asMentee.body.data.find((r: any) => r.id === request1.id).mentor).toEqual(
      expect.objectContaining({ id: mentor.user.id, fullName: expect.any(String), currentDesignation: null })
    );
  });
});

describe('invites', () => {
  it('POST /invites/generate-link answers { link, expiresAt } and ignores a body', async () => {
    const res = await request(app).post('/api/invites/generate-link').set('Authorization', u.member.auth).send({ batchYear: 2011 });
    expect(res.status).toBe(200);
    expect(res.body.data.link).toMatch(/\/register\?ref=/);
    expect(res.body.data.expiresAt).toEqual(expect.any(String));
  });
});
