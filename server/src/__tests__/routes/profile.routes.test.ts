/**
 * HTTP-level profile editing (PRD 6.3): zod validation on the work-experience,
 * education and skills routes plus owner-only updates.
 */
import { api, authAs, getApp, prismaMock } from '../../../tests/helpers';

const ROW_ID = '00000000-0000-4000-8000-00000000abcd';

beforeAll(() => {
  getApp();
}, 60_000);
beforeEach(() => jest.clearAllMocks());

const expectValidationError = (res: { status: number; body: any }, field?: string) => {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  if (field) expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
};

describe('profile editing routes', () => {
  describe('POST /api/users/work-experience', () => {
    it('accepts a date-only start date from the edit form', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.workExperience.create.mockImplementation(({ data }: any) => Promise.resolve({ id: ROW_ID, ...data }));

      const res = await api()
        .post('/api/users/work-experience')
        .set('Authorization', header)
        .send({ company: 'Acme', role: 'Engineer', startDate: '2020-01-01', isCurrent: true, userId: 'someone-else' });

      expect(res.status).toBe(201);
      const { data } = prismaMock.workExperience.create.mock.calls[0][0];
      expect(data.userId).toBe(user.id);
      expect(data.startDate).toEqual(new Date('2020-01-01T00:00:00.000Z'));
      expect(data.endDate).toBeNull();
    });

    it.each([['2020-13-01'], ['2021-02-30'], ['next week']])('400s on an invalid start date (%s)', async (startDate) => {
      const { header } = authAs('MEMBER');
      const res = await api()
        .post('/api/users/work-experience')
        .set('Authorization', header)
        .send({ company: 'Acme', role: 'Engineer', startDate });

      expectValidationError(res, 'body.startDate');
      expect(prismaMock.workExperience.create).not.toHaveBeenCalled();
    });

    it('400s when the end date is before the start date', async () => {
      const { header } = authAs('MEMBER');
      const res = await api()
        .post('/api/users/work-experience')
        .set('Authorization', header)
        .send({ company: 'Acme', role: 'Engineer', startDate: '2021-01-01', endDate: '2020-01-01' });

      expectValidationError(res, 'body.endDate');
    });
  });

  describe('PATCH/DELETE /api/users/work-experience/:id', () => {
    it("404s for another user's row and updates nothing", async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.workExperience.findFirst.mockResolvedValue(null);

      const res = await api()
        .patch(`/api/users/work-experience/${ROW_ID}`)
        .set('Authorization', header)
        .send({ role: 'Hacked' });

      expect(res.status).toBe(404);
      expect(prismaMock.workExperience.findFirst).toHaveBeenCalledWith({ where: { id: ROW_ID, userId: user.id } });
      expect(prismaMock.workExperience.update).not.toHaveBeenCalled();
    });

    it('400s on a malformed id before touching the database', async () => {
      const { header } = authAs('MEMBER');
      const patch = await api().patch('/api/users/work-experience/w1').set('Authorization', header).send({ role: 'R' });
      const del = await api().delete('/api/users/work-experience/w1').set('Authorization', header);

      expectValidationError(patch, 'params.id');
      expectValidationError(del, 'params.id');
      expect(prismaMock.workExperience.findFirst).not.toHaveBeenCalled();
    });

    it('400s on an empty update', async () => {
      const { header } = authAs('MEMBER');
      const res = await api().patch(`/api/users/work-experience/${ROW_ID}`).set('Authorization', header).send({});
      expectValidationError(res);
    });

    it('setting an end date on a current role ends it', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.workExperience.findFirst.mockResolvedValue({
        id: ROW_ID,
        userId: user.id,
        startDate: new Date('2020-01-01'),
        endDate: null,
        isCurrent: true,
      });
      prismaMock.workExperience.update.mockResolvedValue({ id: ROW_ID });

      const res = await api()
        .patch(`/api/users/work-experience/${ROW_ID}`)
        .set('Authorization', header)
        .send({ endDate: '2023-03-01' });

      expect(res.status).toBe(200);
      const { data } = prismaMock.workExperience.update.mock.calls[0][0];
      expect(data.endDate).toEqual(new Date('2023-03-01T00:00:00.000Z'));
      expect(data.isCurrent).toBe(false);
    });

    it('marking a role current clears its end date', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.workExperience.findFirst.mockResolvedValue({
        id: ROW_ID,
        userId: user.id,
        startDate: new Date('2020-01-01'),
        endDate: new Date('2021-01-01'),
        isCurrent: false,
      });
      prismaMock.workExperience.update.mockResolvedValue({ id: ROW_ID });

      const res = await api()
        .patch(`/api/users/work-experience/${ROW_ID}`)
        .set('Authorization', header)
        .send({ isCurrent: true, endDate: '2021-01-01' });

      expect(res.status).toBe(200);
      const { data } = prismaMock.workExperience.update.mock.calls[0][0];
      expect(data).toMatchObject({ isCurrent: true, endDate: null });
    });

    it('DELETE removes only the owner\'s row', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.workExperience.findFirst.mockResolvedValue({ id: ROW_ID, userId: user.id });
      prismaMock.workExperience.delete.mockResolvedValue({ id: ROW_ID });

      const res = await api().delete(`/api/users/work-experience/${ROW_ID}`).set('Authorization', header);

      expect(res.status).toBe(200);
      expect(prismaMock.workExperience.findFirst).toHaveBeenCalledWith({ where: { id: ROW_ID, userId: user.id } });
    });
  });

  describe('education', () => {
    it('400s on a string or out-of-range year', async () => {
      const { header } = authAs('MEMBER');
      const asString = await api()
        .post('/api/users/education')
        .set('Authorization', header)
        .send({ institution: 'AITD', degree: 'B.Tech', startYear: '2015' });
      const reversed = await api()
        .post('/api/users/education')
        .set('Authorization', header)
        .send({ institution: 'AITD', degree: 'B.Tech', startYear: 2015, endYear: 2010 });

      expectValidationError(asString, 'body.startYear');
      expectValidationError(reversed, 'body.endYear');
      expect(prismaMock.education.create).not.toHaveBeenCalled();
    });

    it('creates a valid entry for the signed-in user', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.education.create.mockImplementation(({ data }: any) => Promise.resolve({ id: ROW_ID, ...data }));

      const res = await api()
        .post('/api/users/education')
        .set('Authorization', header)
        .send({ institution: 'AITD', degree: 'B.Tech', fieldOfStudy: 'CS', startYear: 2015, endYear: 2019, isPrimary: true });

      expect(res.status).toBe(201);
      expect(prismaMock.education.create.mock.calls[0][0].data).toMatchObject({ userId: user.id, startYear: 2015, endYear: 2019 });
    });

    it("PATCH another user's education → 404", async () => {
      const { header } = authAs('MEMBER');
      prismaMock.education.findFirst.mockResolvedValue(null);

      const res = await api().patch(`/api/users/education/${ROW_ID}`).set('Authorization', header).send({ grade: 'A' });

      expect(res.status).toBe(404);
      expect(prismaMock.education.update).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/users/skills', () => {
    it('400s on invalid skill lists', async () => {
      const { header } = authAs('MEMBER');
      for (const skills of ['React', ['x'.repeat(51)], Array.from({ length: 51 }, (_, i) => `S${i}`)]) {
        const res = await api().put('/api/users/skills').set('Authorization', header).send({ skills });
        expectValidationError(res);
      }
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('stores a trimmed, de-duplicated list', async () => {
      const { header } = authAs('MEMBER');
      const upserted: string[] = [];
      prismaMock.$transaction.mockImplementation(async (fn: any) =>
        fn({
          userSkill: { deleteMany: jest.fn(), createMany: jest.fn() },
          skill: {
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn(({ where }: any) => {
              upserted.push(where.name);
              return Promise.resolve({ id: where.name });
            }),
          },
        })
      );
      prismaMock.userSkill.findMany.mockResolvedValue([]);

      const res = await api()
        .put('/api/users/skills')
        .set('Authorization', header)
        .send({ skills: [' React ', 'react', 'Node.js'] });

      expect(res.status).toBe(200);
      expect(upserted).toEqual(['React', 'Node.js']);
    });

    it('reuses an existing skill whose name differs only by case', async () => {
      const { header } = authAs('MEMBER');
      const createMany = jest.fn();
      const upsert = jest.fn();
      const findFirst = jest.fn(({ where }: any) =>
        Promise.resolve(where.name.equals.toLowerCase() === 'react' ? { id: 'skill-react', name: 'React' } : null)
      );
      prismaMock.$transaction.mockImplementation(async (fn: any) =>
        fn({ userSkill: { deleteMany: jest.fn(), createMany }, skill: { findFirst, upsert } })
      );
      prismaMock.userSkill.findMany.mockResolvedValue([]);

      const res = await api().put('/api/users/skills').set('Authorization', header).send({ skills: ['react'] });

      expect(res.status).toBe(200);
      expect(findFirst).toHaveBeenCalledWith({ where: { name: { equals: 'react', mode: 'insensitive' } } });
      expect(upsert).not.toHaveBeenCalled();
      expect(createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ skillId: 'skill-react' })]);
    });
  });

  describe('PATCH /api/users/profile', () => {
    it.each([
      [{ linkedinUrl: 'javascript:alert(1)' }, 'body.linkedinUrl'],
      [{ websiteUrl: 'ftp://files.example.com' }, 'body.websiteUrl'],
      [{ locationLat: 123 }, 'body.locationLat'],
      [{ phoneVisibility: 'EVERYONE' }, 'body.phoneVisibility'],
    ])('400s on %j', async (body, field) => {
      const { header } = authAs('MEMBER');
      const res = await api().patch('/api/users/profile').set('Authorization', header).send(body);
      expectValidationError(res, field);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });
});
