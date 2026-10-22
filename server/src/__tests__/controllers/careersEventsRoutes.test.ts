/**
 * Route-level smoke tests: real router + middleware, mocked Prisma.
 * Verifies that viewer identity and status codes flow end-to-end.
 */
jest.mock('../../services/notificationService', () => ({
  notificationService: { createNotification: jest.fn().mockResolvedValue(undefined) },
}));

import { api, authAs, getApp, prismaMock } from '../../../tests/helpers';

const DAY = 24 * 60 * 60 * 1000;

describe('jobs & events routes', () => {
  // Building the app (and compiling every route module) can exceed the per-test
  // timeout when the whole suite runs in parallel, so do it up front.
  beforeAll(() => {
    getApp();
  }, 120_000);

  it('GET /api/jobs maps client params (type, search) into the published-only query', async () => {
    prismaMock.jobOpportunity.findMany.mockResolvedValue([]);
    prismaMock.jobOpportunity.count.mockResolvedValue(0);

    const res = await api().get('/api/jobs?type=INTERNSHIP&search=react&status=DRAFT');

    expect(res.status).toBe(200);
    const { where } = prismaMock.jobOpportunity.findMany.mock.calls[0][0];
    expect(where.status).toBe('PUBLISHED');
    expect(where.jobType).toBe('INTERNSHIP');
    expect(JSON.stringify(where.AND)).toContain('react');
  });

  it('GET /api/jobs rejects an invalid type with 400', async () => {
    const res = await api().get('/api/jobs?type=WIZARD');
    expect(res.status).toBe(400);
  });

  it('GET /api/jobs/:id hides a pending job from anonymous users but shows it to the owner', async () => {
    const { user, header } = authAs('MEMBER');
    prismaMock.jobOpportunity.findUnique.mockResolvedValue({ id: 'j1', postedById: user.id, status: 'PENDING_REVIEW', viewCount: 0 });

    expect((await api().get('/api/jobs/j1')).status).toBe(404);
    const res = await api().get('/api/jobs/j1').set('Authorization', header);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('j1');
  });

  it('POST /api/jobs from a member lands in PENDING_REVIEW', async () => {
    const { header } = authAs('MEMBER');
    prismaMock.jobOpportunity.create.mockImplementation(async (args: any) => ({ id: 'j2', ...args.data }));

    const res = await api()
      .post('/api/jobs')
      .set('Authorization', header)
      .send({ title: 'Dev', description: 'Code', company: 'Acme', salaryMin: 10, salaryMax: 20 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
  });

  it('POST /api/jobs rejects salaryMin > salaryMax', async () => {
    const { header } = authAs('MEMBER');
    const res = await api()
      .post('/api/jobs')
      .set('Authorization', header)
      .send({ title: 'Dev', description: 'Code', company: 'Acme', salaryMin: 30, salaryMax: 20 });
    expect(res.status).toBe(400);
    expect(prismaMock.jobOpportunity.create).not.toHaveBeenCalled();
  });

  it('GET /api/events shows members-only events to signed-in members only', async () => {
    prismaMock.event.findMany.mockResolvedValue([]);
    prismaMock.event.count.mockResolvedValue(0);

    await api().get('/api/events?upcoming=false');
    expect(prismaMock.event.findMany.mock.calls[0][0].where).toEqual({ status: 'PUBLISHED', isPublic: true });

    const { header } = authAs('MEMBER');
    await api().get('/api/events').set('Authorization', header);
    expect(prismaMock.event.findMany.mock.calls[1][0].where).toEqual({ status: 'PUBLISHED' });
  });

  it('POST /api/events/:id/rsvp returns 409 when the event is full', async () => {
    const { header } = authAs('MEMBER');
    prismaMock.event.findUnique.mockResolvedValue({
      id: 'e1',
      status: 'PUBLISHED',
      startDate: new Date(Date.now() + DAY),
      capacity: 1,
      rsvpCount: 1,
      createdById: 'someone',
    });
    prismaMock.eventRSVP.findUnique.mockResolvedValue(null);

    const res = await api().post('/api/events/e1/rsvp').set('Authorization', header);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_FULL');
  });
});
