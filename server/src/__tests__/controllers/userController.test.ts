import { Prisma } from '@prisma/client';
import { userController } from '../../controllers/userController';
import { followService } from '../../services/followService';
import { userService } from '../../services/userService';
import { uploadToStorage } from '../../utils/storage';
import { api, authAs, makeUser, mockReqRes, prismaMock, USER_IDS, OTHER_USER_ID } from '../../../tests/helpers';

jest.mock('../../utils/storage', () => {
  const actual = jest.requireActual('../../utils/storage');
  return {
    __esModule: true,
    ...actual,
    uploadToStorage: jest.fn().mockResolvedValue('/uploads/profiles/new.jpg'),
    deleteFromStorage: jest.fn().mockResolvedValue(undefined),
  };
});

const ME = USER_IDS.MEMBER;
const spies: jest.SpyInstance[] = [];
const spyOn = <K extends keyof typeof userService>(method: K, value: unknown = { ok: true }) => {
  const spy = jest.spyOn(userService, method as any).mockResolvedValue(value as never);
  spies.push(spy);
  return spy;
};

afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  (uploadToStorage as jest.Mock).mockClear();
});

const asUser = (req: Record<string, unknown> = {}) => mockReqRes({ user: { id: ME }, ...req });

describe('userController (unit)', () => {
  describe('simple delegation', () => {
    it.each([
      ['updateProfile', { body: { city: 'Pune' } }, [ME, { city: 'Pune' }], 200],
      ['addWorkExperience', { body: { company: 'A' } }, [ME, { company: 'A' }], 201],
      ['updateWorkExperience', { params: { id: 'w1' }, body: { role: 'R' } }, [ME, 'w1', { role: 'R' }], 200],
      ['deleteWorkExperience', { params: { id: 'w1' } }, [ME, 'w1'], 200],
      ['addEducation', { body: { degree: 'B' } }, [ME, { degree: 'B' }], 201],
      ['updateEducation', { params: { id: 'e1' }, body: { degree: 'M' } }, [ME, 'e1', { degree: 'M' }], 200],
      ['deleteEducation', { params: { id: 'e1' } }, [ME, 'e1'], 200],
      ['updateSkills', { body: { skills: ['Go'] } }, [ME, ['Go']], 200],
      ['getPublicStats', {}, [], 200],
    ] as const)('%s passes the authenticated user id to the service', async (method, reqExtra, expectedArgs, status) => {
      const spy = spyOn(method as any, { done: true });
      const { req, res, next } = asUser(reqExtra as any);

      await (userController as any)[method](req, res, next);

      expect(spy).toHaveBeenCalledWith(...expectedArgs);
      if (status === 201) expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { done: true } });
      expect(next).not.toHaveBeenCalled();
    });

    it.each([
      'getProfile',
      'updateProfile',
      'addWorkExperience',
      'updateWorkExperience',
      'deleteWorkExperience',
      'addEducation',
      'updateEducation',
      'deleteEducation',
      'updateSkills',
      'searchDirectory',
      'getYearbook',
      'getAlumniLocations',
      'getNearbyAlumni',
      'getPublicStats',
      'getNotableAlumni',
    ])('%s forwards service errors to next()', async (method) => {
      const error = new Error('boom');
      const serviceMethod = method === 'searchDirectory' ? 'searchDirectory' : method;
      spies.push(jest.spyOn(userService, serviceMethod as any).mockRejectedValue(error));
      const { req, res, next } = asUser({
        params: { id: 'x', year: '2015' },
        query: { lat: '19', lng: '72' },
        body: {},
      });

      await (userController as any)[method](req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });

    it('getProfile merges follower/following counts and the viewer’s follow state', async () => {
      const spy = spyOn('getProfile', { id: 'u2', postCount: 4 });
      spies.push(
        jest.spyOn(followService, 'profileStats').mockResolvedValue({ followerCount: 9, followingCount: 2, isFollowing: true })
      );
      const { req, res, next } = asUser({ params: { id: 'u2' } });

      await userController.getProfile(req, res, next);

      expect(spy).toHaveBeenCalledWith('u2', ME);
      expect(followService.profileStats).toHaveBeenCalledWith('u2', ME);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: { id: 'u2', postCount: 4, followerCount: 9, followingCount: 2, isFollowing: true },
      });
    });

    it('getProfile works for anonymous viewers', async () => {
      const spy = spyOn('getProfile');
      const { req, res, next } = mockReqRes({ params: { id: 'u2' } });
      await userController.getProfile(req, res, next);
      expect(spy).toHaveBeenCalledWith('u2', undefined);
    });
  });

  describe('photo uploads', () => {
    const image = { mimetype: 'image/png', originalname: 'a.png', buffer: Buffer.from('x') };

    it.each([
      ['updateProfilePhoto', 'profiles'],
      ['updateCoverPhoto', 'covers'],
    ] as const)('%s uploads to %s and saves the URL', async (method, folder) => {
      const spy = spyOn(method, { id: ME });
      const { req, res, next } = asUser({ file: image });

      await userController[method](req, res, next);

      expect(uploadToStorage).toHaveBeenCalledWith(image, folder);
      expect(spy).toHaveBeenCalledWith(ME, '/uploads/profiles/new.jpg');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: ME } });
    });

    it.each(['updateProfilePhoto', 'updateCoverPhoto'] as const)('%s requires a file', async (method) => {
      const spy = spyOn(method);
      const { req, res, next } = asUser();
      await userController[method](req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it.each(['updateProfilePhoto', 'updateCoverPhoto'] as const)('%s rejects non-image files', async (method) => {
      const spy = spyOn(method);
      const { req, res, next } = asUser({ file: { ...image, mimetype: 'application/pdf', originalname: 'cv.pdf' } });
      await userController[method](req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(uploadToStorage).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it.each(['updateProfilePhoto', 'updateCoverPhoto'] as const)('%s forwards upload failures', async (method) => {
      const error = new Error('S3 down');
      (uploadToStorage as jest.Mock).mockRejectedValueOnce(error);
      const { req, res, next } = asUser({ file: image });
      await userController[method](req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('searchDirectory', () => {
    it('picks and parses known filters only', async () => {
      const spy = spyOn('searchDirectory', { data: [], pagination: { total: 0 } });
      const { req, res, next } = asUser({
        query: {
          name: ' Ann ',
          page: '2',
          limit: '24',
          batchYear: '2015',
          batchYearStart: 'abc',
          roleType: 'ALUMNI',
          skills: 'React,Node',
          department: ['CSE', 'ECE'], // repeated param → ignored
          isActive: 'false', // unknown → never forwarded
          email: 'x@y.z',
        },
      });

      await userController.searchDirectory(req, res, next);

      const filters = spy.mock.calls[0][0] as Record<string, unknown>;
      expect(filters).toMatchObject({
        name: 'Ann',
        page: 2,
        limit: 24,
        batchYear: 2015,
        batchYearStart: undefined,
        roleType: 'ALUMNI',
        skills: 'React,Node',
        department: undefined,
      });
      expect(filters).not.toHaveProperty('isActive');
      expect(filters).not.toHaveProperty('email');
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [], pagination: { total: 0 } });
    });

    it('defaults page and limit', async () => {
      const spy = spyOn('searchDirectory', { data: [] });
      const { req, res, next } = asUser({ query: { page: 'x' } });
      await userController.searchDirectory(req, res, next);
      expect(spy.mock.calls[0][0]).toMatchObject({ page: 1, limit: 12 });
    });
  });

  describe('getYearbook', () => {
    it('parses the year and optional department', async () => {
      const spy = spyOn('getYearbook');
      const { req, res, next } = asUser({ params: { year: '2015' }, query: { department: 'CSE' } });
      await userController.getYearbook(req, res, next);
      expect(spy).toHaveBeenCalledWith(2015, 'CSE');
    });

    it.each(['abc', '20x5', '1800', '99999'])('rejects year %s with 400', async (year) => {
      const spy = spyOn('getYearbook');
      const { req, res, next } = asUser({ params: { year } });
      await userController.getYearbook(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getAlumniLocations', () => {
    it('passes parsed bounds and limit', async () => {
      const spy = spyOn('getAlumniLocations', []);
      const { req, res, next } = asUser({ query: { north: '20', south: '10', east: '80', west: '70', limit: '5' } });
      await userController.getAlumniLocations(req, res, next);
      expect(spy).toHaveBeenCalledWith({ north: 20, south: 10, east: 80, west: 70, limit: 5 });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
    });

    it('works without bounds', async () => {
      const spy = spyOn('getAlumniLocations', []);
      const { req, res, next } = asUser();
      await userController.getAlumniLocations(req, res, next);
      expect(spy).toHaveBeenCalledWith({
        north: undefined,
        south: undefined,
        east: undefined,
        west: undefined,
        limit: undefined,
      });
    });

    it('passes audience filters alongside the bounds', async () => {
      const spy = spyOn('getAlumniLocations', []);
      const { req, res, next } = asUser({ query: { batchYear: '2010', department: 'Civil', search: 'ann' } });
      await userController.getAlumniLocations(req, res, next);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ batchYear: 2010, department: 'Civil', search: 'ann' }));
    });

    it.each([
      [{ batchYear: 'soon' }],
      [{ north: '20' }],
      [{ north: 'x', south: '1', east: '1', west: '1' }],
      [{ north: '10', south: '20', east: '1', west: '1' }],
      [{ north: '95', south: '10', east: '1', west: '1' }],
      [{ north: '20', south: '10', east: '200', west: '1' }],
      [{ limit: '0' }],
      [{ limit: 'abc' }],
    ])('rejects %j with 400', async (query) => {
      const spy = spyOn('getAlumniLocations', []);
      const { req, res, next } = asUser({ query });
      await userController.getAlumniLocations(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getNearbyAlumni', () => {
    it('passes coordinates, radius and limit', async () => {
      const spy = spyOn('getNearbyAlumni');
      const { req, res, next } = asUser({ query: { lat: '19.07', lng: '72.87', radius: '25', limit: '10' } });
      await userController.getNearbyAlumni(req, res, next);
      expect(spy).toHaveBeenCalledWith(19.07, 72.87, 25, 10, {});
    });

    it('leaves radius/limit to service defaults when omitted', async () => {
      const spy = spyOn('getNearbyAlumni');
      const { req, res, next } = asUser({ query: { lat: '0', lng: '0' } });
      await userController.getNearbyAlumni(req, res, next);
      expect(spy).toHaveBeenCalledWith(0, 0, undefined, undefined, {});
    });

    it('passes batch, department and search filters (trimmed and length-capped)', async () => {
      const spy = spyOn('getNearbyAlumni');
      const { req, res, next } = asUser({
        query: { lat: '0', lng: '0', batchYear: '2015', department: ' Mech ', search: 'x'.repeat(300) },
      });
      await userController.getNearbyAlumni(req, res, next);
      expect(spy).toHaveBeenCalledWith(0, 0, undefined, undefined, {
        batchYear: 2015,
        department: 'Mech',
        search: 'x'.repeat(100),
      });
    });

    it.each(['20x5', '1800', '2015.5'])('rejects batchYear=%s with 400', async (batchYear) => {
      const spy = spyOn('getNearbyAlumni');
      const { req, res, next } = asUser({ query: { lat: '0', lng: '0', batchYear } });
      await userController.getNearbyAlumni(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      [{}],
      [{ lat: 'x', lng: '1' }],
      [{ lat: '91', lng: '1' }],
      [{ lat: '1', lng: '-181' }],
      [{ lat: '1', lng: '1', radius: '0' }],
      [{ lat: '1', lng: '1', radius: 'far' }],
      [{ lat: '1', lng: '1', limit: '-3' }],
    ])('rejects %j with 400', async (query) => {
      const spy = spyOn('getNearbyAlumni');
      const { req, res, next } = asUser({ query });
      await userController.getNearbyAlumni(req, res, next);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('getNotableAlumni', () => {
    it('parses the limit with a default of 6', async () => {
      const spy = spyOn('getNotableAlumni', []);
      const { req, res, next } = mockReqRes({ query: { limit: '3' } });
      await userController.getNotableAlumni(req, res, next);
      expect(spy).toHaveBeenLastCalledWith(3);

      const second = mockReqRes({ query: { limit: 'lots' } });
      await userController.getNotableAlumni(second.req, second.res, second.next);
      expect(spy).toHaveBeenLastCalledWith(6);
    });
  });
});

describe('user routes (HTTP)', () => {
  const target = (overrides: Record<string, unknown> = {}) => ({
    id: OTHER_USER_ID,
    email: 'other@aitd.test',
    passwordHash: '$2a$10$hash',
    fullName: 'Other',
    phoneNumber: '+91 1',
    phoneVisibility: 'CONNECTIONS',
    locationLat: new Prisma.Decimal(18.5),
    locationLng: new Prisma.Decimal(73.8),
    isLocationPublic: false,
    isActive: true,
    twoFactorEnabled: false,
    _count: { connectionsSent: 0, connectionsReceived: 0, posts: 0 },
    ...overrides,
  });

  /** authenticate() and getProfile() both call user.findUnique — route by id. */
  const arrangeUsers = (viewer: ReturnType<typeof makeUser> | null, profile: Record<string, unknown> | null) => {
    prismaMock.user.findUnique.mockImplementation((args: any) => {
      if (viewer && args.where.id === viewer.id && !args.include) return Promise.resolve(viewer);
      if (profile && args.where.id === profile.id) return Promise.resolve(profile);
      return Promise.resolve(null);
    });
  };

  describe('GET /api/users/:id', () => {
    it('anonymous: no password hash, e-mail, connection-only phone or private coordinates', async () => {
      arrangeUsers(null, target());

      const res = await api().get(`/api/users/${OTHER_USER_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('passwordHash');
      expect(res.body.data).not.toHaveProperty('email');
      expect(res.body.data).not.toHaveProperty('twoFactorEnabled');
      expect(res.body.data.phoneNumber).toBeNull();
      expect(res.body.data.locationLat).toBeNull();
      expect(res.body.data.locationLng).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('$2a$10$hash');
    });

    it('accepted connection sees a CONNECTIONS-only phone', async () => {
      const { header } = authAs('MEMBER');
      const viewer = makeUser('MEMBER');
      arrangeUsers(viewer, target());
      prismaMock.connection.findFirst.mockResolvedValue({ status: 'ACCEPTED' });

      const res = await api().get(`/api/users/${OTHER_USER_ID}`).set('Authorization', header);

      expect(res.status).toBe(200);
      expect(res.body.data.phoneNumber).toBe('+91 1');
      expect(res.body.data.isConnected).toBe(true);
      expect(res.body.data.email).toBe('other@aitd.test');
    });

    it('404s for a deactivated account', async () => {
      const { header } = authAs('MEMBER');
      arrangeUsers(makeUser('MEMBER'), target({ isActive: false }));

      const res = await api().get(`/api/users/${OTHER_USER_ID}`).set('Authorization', header);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('PATCH /api/users/profile', () => {
    it('cannot escalate role or flip system flags through the profile endpoint', async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.user.findUnique.mockImplementation((args: any) => {
        if (args.include) return Promise.resolve(target({ id: user.id }));
        if (args.select) return Promise.resolve({ id: user.id, isActive: true, coverPhotoUrl: null });
        return Promise.resolve(user);
      });
      prismaMock.user.update.mockResolvedValue({});

      const res = await api()
        .patch('/api/users/profile')
        .set('Authorization', header)
        .send({ city: 'Pune', userRole: 'SUPER_ADMIN', isVerified: true, isNotable: true, email: 'x@evil.io' });

      expect(res.status).toBe(200);
      const { data } = prismaMock.user.update.mock.calls[0][0];
      expect(data.city).toBe('Pune');
      expect(data).not.toHaveProperty('userRole');
      expect(data).not.toHaveProperty('isVerified');
      expect(data).not.toHaveProperty('isNotable');
      expect(data).not.toHaveProperty('email');
      expect(res.body.data).not.toHaveProperty('passwordHash');
    });
  });

  describe('work experience ownership', () => {
    it("PATCH another user's work experience → 404 and nothing updated", async () => {
      const { header, user } = authAs('MEMBER');
      prismaMock.workExperience.findFirst.mockResolvedValue(null);

      const res = await api()
        .patch('/api/users/work-experience/00000000-0000-4000-8000-00000000abcd')
        .set('Authorization', header)
        .send({ role: 'Hacked' });

      expect(res.status).toBe(404);
      expect(prismaMock.workExperience.findFirst).toHaveBeenCalledWith({
        where: { id: '00000000-0000-4000-8000-00000000abcd', userId: user.id },
      });
      expect(prismaMock.workExperience.update).not.toHaveBeenCalled();
    });

    it("DELETE another user's education → 404 and nothing deleted", async () => {
      const { header } = authAs('MEMBER');
      prismaMock.education.findFirst.mockResolvedValue(null);

      const res = await api()
        .delete('/api/users/education/00000000-0000-4000-8000-00000000abcd')
        .set('Authorization', header);

      expect(res.status).toBe(404);
      expect(prismaMock.education.delete).not.toHaveBeenCalled();
    });
  });

  describe('discovery endpoints', () => {
    it('GET /api/users/nearby validates input before querying', async () => {
      const { header } = authAs('MEMBER');
      const res = await api().get('/api/users/nearby?lat=200&lng=0').set('Authorization', header);
      expect(res.status).toBe(400);
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });

    it('GET /api/users/directory rejects an unknown roleType with 400', async () => {
      const { header } = authAs('MEMBER');
      const res = await api().get('/api/users/directory?roleType=SUPER_ADMIN').set('Authorization', header);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
