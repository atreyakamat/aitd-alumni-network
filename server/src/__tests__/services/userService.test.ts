import { Prisma } from '@prisma/client';
import {
  userService,
  MAX_SKILLS,
  MAX_SKILL_NAME_LENGTH,
  NEARBY_MAX_LIMIT,
  NEARBY_MAX_RADIUS_KM,
  LOCATIONS_MAX_LIMIT,
  NOTABLE_MAX_LIMIT,
  YEARBOOK_MAX_RESULTS,
  LOCATION_PRECISION_DECIMALS,
} from '../../services/userService';
import { prismaMock } from '../../../tests/helpers';
import { deleteFromStorage } from '../../utils/storage';

jest.mock('../../utils/storage', () => {
  const actual = jest.requireActual('../../utils/storage');
  return { __esModule: true, ...actual, deleteFromStorage: jest.fn().mockResolvedValue(undefined) };
});

const OWNER = 'owner-id';
const VIEWER = 'viewer-id';

const profileRow = (overrides: Record<string, unknown> = {}) => ({
  id: OWNER,
  email: 'owner@aitd.test',
  secondaryEmail: 'alt@aitd.test',
  passwordHash: '$2a$10$secret',
  fullName: 'Owner',
  phoneNumber: '+91 99999 00000',
  phoneVisibility: 'PRIVATE',
  locationLat: new Prisma.Decimal('19.0760'),
  locationLng: new Prisma.Decimal('72.8777'),
  isLocationPublic: false,
  isActive: true,
  twoFactorEnabled: true,
  lastLoginAt: new Date(),
  emailVerifiedAt: new Date(),
  userRole: 'MEMBER',
  _count: { connectionsSent: 2, connectionsReceived: 3, posts: 4 },
  ...overrides,
});

const acceptedConnection = { id: 'c1', status: 'ACCEPTED', requesterId: VIEWER, addresseeId: OWNER };

describe('userService', () => {
  beforeEach(() => {
    (deleteFromStorage as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  describe('getProfile', () => {
    it('never returns the password hash, and computes counts for the owner', async () => {
      prismaMock.user.findUnique.mockResolvedValue(profileRow());

      const profile: any = await userService.getProfile(OWNER, OWNER);

      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile.connectionCount).toBe(5);
      expect(profile.postCount).toBe(4);
      expect(profile.isOwnProfile).toBe(true);
      expect(profile.isConnected).toBe(false);
      expect(profile.connectionStatus).toBeNull();
      // Owner sees everything about themselves
      expect(profile.phoneNumber).toBe('+91 99999 00000');
      expect(profile.locationLat).toBeCloseTo(19.076);
      expect(profile.locationLng).toBeCloseTo(72.8777);
      expect(profile.email).toBe('owner@aitd.test');
      expect(profile.twoFactorEnabled).toBe(true);
      expect(prismaMock.connection.findFirst).not.toHaveBeenCalled();
    });

    it('does not load credential/token relations', async () => {
      prismaMock.user.findUnique.mockResolvedValue(profileRow());
      await userService.getProfile(OWNER, OWNER);
      const { include } = prismaMock.user.findUnique.mock.calls[0][0];
      expect(include.refreshTokens).toBeUndefined();
      expect(include.verificationTokens).toBeUndefined();
    });

    it('404s for a missing user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(userService.getProfile('nope', VIEWER)).rejects.toMatchObject({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
      });
    });

    it('hides deactivated accounts from other viewers and anonymous visitors', async () => {
      prismaMock.user.findUnique.mockResolvedValue(profileRow({ isActive: false }));
      await expect(userService.getProfile(OWNER, VIEWER)).rejects.toMatchObject({ statusCode: 404 });
      await expect(userService.getProfile(OWNER)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('still lets the owner load their own deactivated profile', async () => {
      prismaMock.user.findUnique.mockResolvedValue(profileRow({ isActive: false }));
      await expect(userService.getProfile(OWNER, OWNER)).resolves.toMatchObject({ id: OWNER });
    });

    it('strips owner-only fields for other viewers', async () => {
      prismaMock.user.findUnique.mockResolvedValue(profileRow());
      prismaMock.connection.findFirst.mockResolvedValue(null);

      const profile: any = await userService.getProfile(OWNER, VIEWER);

      expect(profile).not.toHaveProperty('passwordHash');
      expect(profile).not.toHaveProperty('twoFactorEnabled');
      expect(profile).not.toHaveProperty('lastLoginAt');
      expect(profile).not.toHaveProperty('emailVerifiedAt');
      expect(profile.isOwnProfile).toBe(false);
      // Logged-in members can see the contact e-mail
      expect(profile.email).toBe('owner@aitd.test');
    });

    it('hides contact e-mails from anonymous visitors', async () => {
      prismaMock.user.findUnique.mockResolvedValue(profileRow({ phoneVisibility: 'PUBLIC' }));

      const profile: any = await userService.getProfile(OWNER);

      expect(profile).not.toHaveProperty('email');
      expect(profile).not.toHaveProperty('secondaryEmail');
      expect(profile.isOwnProfile).toBe(false);
      expect(prismaMock.connection.findFirst).not.toHaveBeenCalled();
    });

    describe('phone visibility', () => {
      it.each([
        ['PUBLIC', null, true],
        ['PUBLIC', 'PENDING', true],
        ['CONNECTIONS', 'ACCEPTED', true],
        ['CONNECTIONS', 'PENDING', false],
        ['CONNECTIONS', null, false],
        ['PRIVATE', 'ACCEPTED', false],
        ['PRIVATE', null, false],
        ['SOMETHING_ELSE', 'ACCEPTED', false],
      ])('%s with connection %s → visible=%s', async (visibility, status, visible) => {
        prismaMock.user.findUnique.mockResolvedValue(profileRow({ phoneVisibility: visibility }));
        prismaMock.connection.findFirst.mockResolvedValue(status ? { ...acceptedConnection, status } : null);

        const profile: any = await userService.getProfile(OWNER, VIEWER);

        expect(profile.phoneNumber).toBe(visible ? '+91 99999 00000' : null);
        expect(profile.connectionStatus).toBe(status);
        expect(profile.isConnected).toBe(status === 'ACCEPTED');
      });

      it('CONNECTIONS is hidden from anonymous visitors', async () => {
        prismaMock.user.findUnique.mockResolvedValue(profileRow({ phoneVisibility: 'CONNECTIONS' }));
        const profile: any = await userService.getProfile(OWNER);
        expect(profile.phoneNumber).toBeNull();
      });

      it('looks up the connection in both directions', async () => {
        prismaMock.user.findUnique.mockResolvedValue(profileRow());
        prismaMock.connection.findFirst.mockResolvedValue(null);
        await userService.getProfile(OWNER, VIEWER);
        expect(prismaMock.connection.findFirst.mock.calls[0][0].where.OR).toEqual([
          { requesterId: VIEWER, addresseeId: OWNER },
          { requesterId: OWNER, addresseeId: VIEWER },
        ]);
      });
    });

    describe('location visibility', () => {
      it('hides precise coordinates when the location is private (even from connections)', async () => {
        prismaMock.user.findUnique.mockResolvedValue(profileRow({ isLocationPublic: false }));
        prismaMock.connection.findFirst.mockResolvedValue(acceptedConnection);

        const profile: any = await userService.getProfile(OWNER, VIEWER);

        expect(profile.locationLat).toBeNull();
        expect(profile.locationLng).toBeNull();
      });

      it('shows coordinates when the location is public', async () => {
        prismaMock.user.findUnique.mockResolvedValue(profileRow({ isLocationPublic: true }));

        const profile: any = await userService.getProfile(OWNER);

        expect(profile.locationLat).toBeCloseTo(19.076);
        expect(profile.locationLng).toBeCloseTo(72.8777);
      });

      it('returns null coordinates when none are stored', async () => {
        prismaMock.user.findUnique.mockResolvedValue(profileRow({ locationLat: null, locationLng: null }));
        const profile: any = await userService.getProfile(OWNER, OWNER);
        expect(profile.locationLat).toBeNull();
        expect(profile.locationLng).toBeNull();
      });
    });
  });

  describe('updateProfile', () => {
    const existing = {
      id: OWNER,
      isActive: true,
      profilePhotoUrl: null,
      coverPhotoUrl: null,
      shortBio: null,
      city: 'Pune',
      linkedinUrl: null,
      currentDesignation: null,
    };

    const arrange = (overrides: Record<string, unknown> = {}) => {
      prismaMock.user.findUnique.mockImplementation((args: any) =>
        Promise.resolve(args.include ? profileRow() : { ...existing, ...overrides })
      );
      prismaMock.user.update.mockResolvedValue({});
    };

    const updateData = () => prismaMock.user.update.mock.calls[0][0].data;

    it('writes only whitelisted fields (no mass assignment)', async () => {
      arrange();

      await userService.updateProfile(OWNER, {
        fullName: '  New Name ',
        currentDesignation: 'Engineer',
        userRole: 'SUPER_ADMIN',
        isVerified: true,
        isActive: false,
        email: 'hijack@evil.test',
        isNotable: true,
        membershipTierId: 'gold',
        profileCompleteness: 100,
        passwordHash: 'x',
        id: 'someone-else',
      } as any);

      const data = updateData();
      expect(data.fullName).toBe('New Name');
      expect(data.currentDesignation).toBe('Engineer');
      for (const forbidden of [
        'userRole',
        'isVerified',
        'isActive',
        'email',
        'isNotable',
        'membershipTierId',
        'passwordHash',
        'id',
      ]) {
        expect(data).not.toHaveProperty(forbidden);
      }
      expect(prismaMock.user.update.mock.calls[0][0].where).toEqual({ id: OWNER });
      // profileCompleteness is recomputed, never taken from input
      expect(data.profileCompleteness).toBe(20 + 15 + 15); // base + city + designation
    });

    it('recomputes completeness from the merged existing + new values in a single write', async () => {
      arrange({ profilePhotoUrl: 'https://cdn.example.com/a.jpg' });

      await userService.updateProfile(OWNER, {
        shortBio: 'x'.repeat(60),
        linkedinUrl: 'https://linkedin.com/in/me',
        city: null,
      });

      expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
      // base 20 + photo 20 + bio 15 + linkedin 15 (city cleared)
      expect(updateData().profileCompleteness).toBe(70);
    });

    it('returns the refreshed own profile', async () => {
      arrange();
      const result: any = await userService.updateProfile(OWNER, { city: 'Mumbai' });
      expect(result.isOwnProfile).toBe(true);
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('does not wipe the saved location when coordinates are not part of the update', async () => {
      arrange();
      await userService.updateProfile(OWNER, { city: 'Mumbai' });
      expect(updateData()).not.toHaveProperty('locationLat');
      expect(updateData()).not.toHaveProperty('locationLng');
    });

    it('stores 0 coordinates (equator / prime meridian) instead of nulling them', async () => {
      arrange();
      await userService.updateProfile(OWNER, { locationLat: 0, locationLng: 0 });
      expect(updateData().locationLat).toEqual(new Prisma.Decimal(0));
      expect(updateData().locationLng).toEqual(new Prisma.Decimal(0));
    });

    it('clears coordinates when null is sent explicitly and accepts numeric strings', async () => {
      arrange();
      await userService.updateProfile(OWNER, { locationLat: null, locationLng: '72.5' as any });
      expect(updateData().locationLat).toBeNull();
      expect(updateData().locationLng).toEqual(new Prisma.Decimal('72.5'));
    });

    it('stores only an approximate (~1 km) location so the map never pinpoints a home', async () => {
      arrange();
      await userService.updateProfile(OWNER, { locationLat: 18.521374, locationLng: -73.856749 });
      expect(updateData().locationLat).toEqual(new Prisma.Decimal('18.52'));
      expect(updateData().locationLng).toEqual(new Prisma.Decimal('-73.86'));
    });

    it('derives the map pin from the work location when one is set (work beats residence)', async () => {
      arrange();
      await userService.updateProfile(OWNER, { workLat: 15.49, workLng: 73.82, homeLat: 19.07, homeLng: 72.87 });
      const data = updateData();
      expect(Number(data.workLat)).toBeCloseTo(15.49);
      expect(Number(data.homeLat)).toBeCloseTo(19.07);
      // locationLat/Lng is the derived map pin and follows the work location
      expect(Number(data.locationLat)).toBeCloseTo(15.49);
      expect(Number(data.locationLng)).toBeCloseTo(73.82);
    });

    it('falls back to the residence for the map pin when work coordinates are cleared', async () => {
      arrange({ homeLat: new Prisma.Decimal('19.07'), homeLng: new Prisma.Decimal('72.87'), workLat: new Prisma.Decimal('15.49'), workLng: new Prisma.Decimal('73.82') });
      await userService.updateProfile(OWNER, { workLat: null, workLng: null });
      const data = updateData();
      expect(data.workLat).toBeNull();
      expect(Number(data.locationLat)).toBeCloseTo(19.07);
      expect(Number(data.locationLng)).toBeCloseTo(72.87);
    });

    it.each([
      [{ locationLat: 91 }],
      [{ locationLat: -90.5 }],
      [{ workLat: 200 }],
      [{ locationLng: 181 }],
      [{ locationLng: 'abc' }],
      [{ locationLat: Number.NaN }],
      [{ phoneVisibility: 'EVERYONE' }],
      [{ fullName: '   ' }],
      [{ fullName: 42 }],
      [{ isLocationPublic: 'yes' }],
    ])('rejects invalid input %j with 400', async (input) => {
      arrange();
      await expect(userService.updateProfile(OWNER, input as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('accepts valid privacy settings', async () => {
      arrange();
      await userService.updateProfile(OWNER, { phoneVisibility: 'CONNECTIONS', isLocationPublic: true });
      expect(updateData()).toMatchObject({ phoneVisibility: 'CONNECTIONS', isLocationPublic: true });
    });

    it('404s for a missing or deactivated account', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(userService.updateProfile(OWNER, { city: 'x' })).rejects.toMatchObject({ statusCode: 404 });

      prismaMock.user.findUnique.mockResolvedValue({ ...existing, isActive: false });
      await expect(userService.updateProfile(OWNER, { city: 'x' })).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it("refuses to point a photo at another file in our own storage", async () => {
      arrange({ profilePhotoUrl: '/uploads/profiles/mine.jpg' });

      await expect(
        userService.updateProfile(OWNER, { profilePhotoUrl: '/uploads/profiles/someone-elses.jpg' })
      ).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PHOTO_URL' });
      await expect(
        userService.updateProfile(OWNER, { coverPhotoUrl: '/uploads/covers/other.jpg' })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('allows re-sending the current photo, clearing it, or using an external URL', async () => {
      arrange({ profilePhotoUrl: '/uploads/profiles/mine.jpg' });
      await userService.updateProfile(OWNER, {
        profilePhotoUrl: '/uploads/profiles/mine.jpg',
        coverPhotoUrl: 'https://images.example.com/cover.png',
      });
      expect(updateData()).toMatchObject({
        profilePhotoUrl: '/uploads/profiles/mine.jpg',
        coverPhotoUrl: 'https://images.example.com/cover.png',
      });

      prismaMock.user.update.mockClear();
      await userService.updateProfile(OWNER, { profilePhotoUrl: null });
      expect(updateData().profilePhotoUrl).toBeNull();
    });

    it('treats a non-object body as an empty update', async () => {
      arrange();
      await userService.updateProfile(OWNER, null as any);
      expect(Object.keys(updateData())).toEqual(['profileCompleteness']);
    });
  });

  describe('work experience', () => {
    const valid = { company: ' Acme ', role: 'Engineer', startDate: '2020-01-01', description: 'Built things' };

    it('creates for the authenticated user only, ignoring a userId in the body', async () => {
      prismaMock.workExperience.create.mockResolvedValue({ id: 'w1' });

      await userService.addWorkExperience(OWNER, { ...valid, userId: 'victim', id: 'forced' } as any);

      const { data } = prismaMock.workExperience.create.mock.calls[0][0];
      expect(data.userId).toBe(OWNER);
      expect(data).not.toHaveProperty('id');
      expect(data.company).toBe('Acme');
      expect(data.startDate).toEqual(new Date('2020-01-01'));
      expect(data).not.toHaveProperty('endDate');
    });

    it('forces endDate to null for a current role', async () => {
      prismaMock.workExperience.create.mockResolvedValue({ id: 'w1' });
      await userService.addWorkExperience(OWNER, { ...valid, isCurrent: true, endDate: '2021-01-01' });
      const { data } = prismaMock.workExperience.create.mock.calls[0][0];
      expect(data.isCurrent).toBe(true);
      expect(data.endDate).toBeNull();
    });

    it.each([
      [{ ...valid, company: '' }],
      [{ ...valid, role: undefined }],
      [{ ...valid, startDate: 'not-a-date' }],
      [{ ...valid, startDate: undefined }],
      [{ ...valid, endDate: '2019-01-01' }],
      [{ ...valid, endDate: 'garbage' }],
    ])('rejects invalid work experience %j', async (input) => {
      await expect(userService.addWorkExperience(OWNER, input as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.workExperience.create).not.toHaveBeenCalled();
    });

    it('rejects a non-object body', async () => {
      await expect(userService.addWorkExperience(OWNER, undefined as any)).rejects.toMatchObject({ statusCode: 400 });
    });

    describe('update', () => {
      const record = { id: 'w1', userId: OWNER, startDate: new Date('2020-01-01'), endDate: null };

      it("only finds the caller's own record and never modifies another user's", async () => {
        prismaMock.workExperience.findFirst.mockResolvedValue(null);

        await expect(userService.updateWorkExperience(VIEWER, 'w1', { role: 'CTO' })).rejects.toMatchObject({
          statusCode: 404,
        });
        expect(prismaMock.workExperience.findFirst).toHaveBeenCalledWith({ where: { id: 'w1', userId: VIEWER } });
        expect(prismaMock.workExperience.update).not.toHaveBeenCalled();
      });

      it('updates only whitelisted fields (cannot move the record to another user)', async () => {
        prismaMock.workExperience.findFirst.mockResolvedValue(record);
        prismaMock.workExperience.update.mockResolvedValue({ id: 'w1' });

        await userService.updateWorkExperience(OWNER, 'w1', { role: 'CTO', userId: 'victim', id: 'x' } as any);

        const args = prismaMock.workExperience.update.mock.calls[0][0];
        expect(args.where).toEqual({ id: 'w1' });
        expect(args.data).toEqual({ role: 'CTO' });
      });

      it('clears endDate when null is sent', async () => {
        prismaMock.workExperience.findFirst.mockResolvedValue({ ...record, endDate: new Date('2021-01-01') });
        prismaMock.workExperience.update.mockResolvedValue({ id: 'w1' });

        await userService.updateWorkExperience(OWNER, 'w1', { endDate: null, isCurrent: true });

        expect(prismaMock.workExperience.update.mock.calls[0][0].data).toEqual({ endDate: null, isCurrent: true });
      });

      it('parses dates and validates against the stored start date', async () => {
        prismaMock.workExperience.findFirst.mockResolvedValue(record);
        prismaMock.workExperience.update.mockResolvedValue({ id: 'w1' });

        await userService.updateWorkExperience(OWNER, 'w1', { endDate: '2022-06-01' });
        expect(prismaMock.workExperience.update.mock.calls[0][0].data.endDate).toEqual(new Date('2022-06-01'));

        await expect(
          userService.updateWorkExperience(OWNER, 'w1', { endDate: '2019-06-01' })
        ).rejects.toMatchObject({ statusCode: 400 });
        await expect(
          userService.updateWorkExperience(OWNER, 'w1', { startDate: '2023-01-01', endDate: '2022-01-01' })
        ).rejects.toMatchObject({ statusCode: 400 });
      });

      it('rejects blanking required fields', async () => {
        prismaMock.workExperience.findFirst.mockResolvedValue(record);
        await expect(userService.updateWorkExperience(OWNER, 'w1', { company: ' ' })).rejects.toMatchObject({
          statusCode: 400,
        });
      });
    });

    describe('delete', () => {
      it("404s for another user's record and does not delete it", async () => {
        prismaMock.workExperience.findFirst.mockResolvedValue(null);
        await expect(userService.deleteWorkExperience(VIEWER, 'w1')).rejects.toMatchObject({ statusCode: 404 });
        expect(prismaMock.workExperience.findFirst).toHaveBeenCalledWith({ where: { id: 'w1', userId: VIEWER } });
        expect(prismaMock.workExperience.delete).not.toHaveBeenCalled();
      });

      it('deletes the owned record', async () => {
        prismaMock.workExperience.findFirst.mockResolvedValue({ id: 'w1', userId: OWNER });
        await expect(userService.deleteWorkExperience(OWNER, 'w1')).resolves.toEqual({
          message: 'Work experience deleted',
        });
        expect(prismaMock.workExperience.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
      });
    });
  });

  describe('education', () => {
    const valid = { institution: 'AITD', degree: 'B.Tech', startYear: 2016, endYear: 2020, isPrimary: true };

    it('creates for the authenticated user only, ignoring a userId in the body', async () => {
      prismaMock.education.create.mockResolvedValue({ id: 'e1' });

      await userService.addEducation(OWNER, { ...valid, userId: 'victim', id: 'forced', grade: 'A' } as any);

      const { data } = prismaMock.education.create.mock.calls[0][0];
      expect(data).toEqual({ ...valid, grade: 'A', userId: OWNER });
    });

    it('allows a missing/null end year', async () => {
      prismaMock.education.create.mockResolvedValue({ id: 'e1' });
      await userService.addEducation(OWNER, { ...valid, endYear: null });
      expect(prismaMock.education.create.mock.calls[0][0].data.endYear).toBeNull();
    });

    it.each([
      [{ ...valid, institution: '' }],
      [{ ...valid, degree: undefined }],
      [{ ...valid, startYear: 1800 }],
      [{ ...valid, startYear: '2016' }],
      [{ ...valid, startYear: 2016.5 }],
      [{ ...valid, endYear: 2010 }],
      [{ ...valid, endYear: 3000 }],
    ])('rejects invalid education %j', async (input) => {
      await expect(userService.addEducation(OWNER, input as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.education.create).not.toHaveBeenCalled();
    });

    it("update: 404s for another user's record and never modifies it", async () => {
      prismaMock.education.findFirst.mockResolvedValue(null);
      await expect(userService.updateEducation(VIEWER, 'e1', { degree: 'PhD' })).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(prismaMock.education.findFirst).toHaveBeenCalledWith({ where: { id: 'e1', userId: VIEWER } });
      expect(prismaMock.education.update).not.toHaveBeenCalled();
    });

    it('update: writes only whitelisted fields', async () => {
      prismaMock.education.findFirst.mockResolvedValue({ id: 'e1', userId: OWNER, startYear: 2016, endYear: 2020 });
      prismaMock.education.update.mockResolvedValue({ id: 'e1' });

      await userService.updateEducation(OWNER, 'e1', { degree: 'M.Tech', userId: 'victim' } as any);

      expect(prismaMock.education.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { degree: 'M.Tech' } });
    });

    it('update: validates year order against the stored record', async () => {
      prismaMock.education.findFirst.mockResolvedValue({ id: 'e1', userId: OWNER, startYear: 2016, endYear: 2020 });
      await expect(userService.updateEducation(OWNER, 'e1', { startYear: 2021 })).rejects.toMatchObject({
        statusCode: 400,
      });
      expect(prismaMock.education.update).not.toHaveBeenCalled();
    });

    it("delete: 404s for another user's record", async () => {
      prismaMock.education.findFirst.mockResolvedValue(null);
      await expect(userService.deleteEducation(VIEWER, 'e1')).rejects.toMatchObject({ statusCode: 404 });
      expect(prismaMock.education.delete).not.toHaveBeenCalled();
    });

    it('delete: removes the owned record', async () => {
      prismaMock.education.findFirst.mockResolvedValue({ id: 'e1', userId: OWNER });
      await expect(userService.deleteEducation(OWNER, 'e1')).resolves.toEqual({ message: 'Education deleted' });
      expect(prismaMock.education.delete).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });
  });

  describe('updateSkills', () => {
    beforeEach(() => {
      prismaMock.skill.upsert.mockImplementation((args: any) =>
        Promise.resolve({ id: `skill:${args.where.name.toLowerCase()}`, name: args.where.name })
      );
      prismaMock.userSkill.findMany.mockResolvedValue([{ id: 'us1' }]);
    });

    it('normalises, de-duplicates and replaces the skill set atomically', async () => {
      const result = await userService.updateSkills(OWNER, [
        ' React ',
        'react',
        'Node   JS',
        '',
        '   ',
        'TypeScript',
        'REACT',
        42 as any,
      ]);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(prismaMock.userSkill.deleteMany).toHaveBeenCalledWith({ where: { userId: OWNER } });
      const names = prismaMock.skill.upsert.mock.calls.map((c: any[]) => c[0].where.name);
      expect(names).toEqual(['React', 'Node JS', 'TypeScript']);
      expect(prismaMock.userSkill.createMany).toHaveBeenCalledWith({
        data: [
          { userId: OWNER, skillId: 'skill:react' },
          { userId: OWNER, skillId: 'skill:node js' },
          { userId: OWNER, skillId: 'skill:typescript' },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual([{ id: 'us1' }]);
    });

    it('clears all skills for an empty list without creating anything', async () => {
      await userService.updateSkills(OWNER, []);
      expect(prismaMock.userSkill.deleteMany).toHaveBeenCalledWith({ where: { userId: OWNER } });
      expect(prismaMock.skill.upsert).not.toHaveBeenCalled();
      expect(prismaMock.userSkill.createMany).not.toHaveBeenCalled();
    });

    it(`caps the number of skills at ${MAX_SKILLS}`, async () => {
      const tooMany = Array.from({ length: MAX_SKILLS + 1 }, (_, i) => `skill-${i}`);
      await expect(userService.updateSkills(OWNER, tooMany)).rejects.toMatchObject({
        statusCode: 400,
        code: 'TOO_MANY_SKILLS',
      });
      expect(prismaMock.userSkill.deleteMany).not.toHaveBeenCalled();
    });

    it('counts the cap after de-duplication', async () => {
      const dupes = Array.from({ length: MAX_SKILLS * 2 }, (_, i) => (i % 2 ? 'Go' : 'go'));
      await expect(userService.updateSkills(OWNER, dupes)).resolves.toBeDefined();
      expect(prismaMock.skill.upsert).toHaveBeenCalledTimes(1);
    });

    it('rejects overly long skill names', async () => {
      await expect(userService.updateSkills(OWNER, ['x'.repeat(MAX_SKILL_NAME_LENGTH + 1)])).rejects.toMatchObject({
        statusCode: 400,
      });
    });

    it('rejects a non-array payload', async () => {
      await expect(userService.updateSkills(OWNER, 'React' as any)).rejects.toMatchObject({ statusCode: 400 });
      await expect(userService.updateSkills(OWNER, undefined as any)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.userSkill.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('searchDirectory', () => {
    beforeEach(() => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prismaMock.user.count.mockResolvedValue(30);
    });

    const findArgs = () => prismaMock.user.findMany.mock.calls[0][0];

    it('only lists active, verified users and never selects private fields', async () => {
      const result = await userService.searchDirectory({ page: 2, limit: 10 });

      const args = findArgs();
      expect(args.where).toEqual({ isActive: true, isVerified: true });
      for (const field of ['email', 'phoneNumber', 'locationLat', 'locationLng', 'passwordHash', 'secondaryEmail']) {
        expect(args.select[field]).toBeUndefined();
      }
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(prismaMock.user.count).toHaveBeenCalledWith({ where: args.where });
      expect(result.pagination).toMatchObject({ total: 30, page: 2, limit: 10, totalPages: 3 });
    });

    it('caps the page size', async () => {
      await userService.searchDirectory({ page: 1, limit: 10_000 });
      expect(findArgs().take).toBe(100);
    });

    it('applies every filter', async () => {
      await userService.searchDirectory({
        name: 'Ann',
        roleType: 'ALUMNI',
        department: 'CSE',
        city: 'Pune',
        hometown: 'Goa',
        designation: 'Engineer',
        chapterId: 'ch1',
        company: 'Acme',
        industry: 'Fintech',
        skills: 'React, Node ,,React',
      });

      expect(findArgs().where).toMatchObject({
        isActive: true,
        isVerified: true,
        fullName: { contains: 'Ann', mode: 'insensitive' },
        roleType: 'ALUMNI',
        department: { contains: 'CSE', mode: 'insensitive' },
        city: { contains: 'Pune', mode: 'insensitive' },
        hometown: { contains: 'Goa', mode: 'insensitive' },
        currentDesignation: { contains: 'Engineer', mode: 'insensitive' },
        chapterMemberships: { some: { chapterId: 'ch1' } },
        workExperiences: {
          some: {
            OR: [
              { company: { contains: 'Acme', mode: 'insensitive' } },
              { description: { contains: 'Fintech', mode: 'insensitive' } },
              { role: { contains: 'Fintech', mode: 'insensitive' } },
            ],
          },
        },
        skills: {
          some: {
            skill: {
              OR: [
                { name: { equals: 'React', mode: 'insensitive' } },
                { name: { equals: 'Node', mode: 'insensitive' } },
              ],
            },
          },
        },
      });
    });

    it('filters by company alone', async () => {
      await userService.searchDirectory({ company: 'Acme' });
      expect(findArgs().where.workExperiences).toEqual({ some: { OR: [{ company: { contains: 'Acme', mode: 'insensitive' } }] } });
    });

    it('prefers an exact batch year over a range', async () => {
      await userService.searchDirectory({ batchYear: 2015, batchYearStart: 2010 });
      expect(findArgs().where.batchYear).toBe(2015);
    });

    it('supports an open-ended batch year range', async () => {
      await userService.searchDirectory({ batchYearStart: 2010 });
      expect(findArgs().where.batchYear).toEqual({ gte: 2010, lte: undefined });
    });

    it('ignores an all-blank skills filter', async () => {
      await userService.searchDirectory({ skills: ' , ,' });
      expect(findArgs().where.skills).toBeUndefined();
    });

    it('rejects an unknown roleType instead of erroring in the database', async () => {
      await expect(userService.searchDirectory({ roleType: 'ADMIN' })).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getYearbook', () => {
    it('lists active, verified alumni of the batch with a bounded result set', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      const result = await userService.getYearbook(2015, 'CSE');

      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ batchYear: 2015, isActive: true, isVerified: true, department: 'CSE' });
      expect(args.take).toBe(YEARBOOK_MAX_RESULTS);
      for (const field of ['email', 'phoneNumber', 'locationLat', 'locationLng']) {
        expect(args.select[field]).toBeUndefined();
      }
      expect(result).toEqual({ batchYear: 2015, department: 'CSE', count: 2, alumni: [{ id: 'a' }, { id: 'b' }] });
    });

    it('treats department "all" as no filter', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await userService.getYearbook(2015, 'all');
      expect(prismaMock.user.findMany.mock.calls[0][0].where.department).toBeUndefined();
    });

    it('rejects a non-integer year', async () => {
      await expect(userService.getYearbook(Number.NaN)).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('getAlumniLocations', () => {
    const mapRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'a',
      locationLat: new Prisma.Decimal('18.5'),
      locationLng: new Prisma.Decimal('73.8'),
      workExperiences: [],
      ...overrides,
    });

    it('only returns active, verified users who made their location public', async () => {
      prismaMock.user.findMany.mockResolvedValue([mapRow()]);

      const result = await userService.getAlumniLocations();

      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        isActive: true,
        isVerified: true,
        isLocationPublic: true,
        locationLat: { not: null },
        locationLng: { not: null },
      });
      expect(args.select.email).toBeUndefined();
      expect(args.select.phoneNumber).toBeUndefined();
      expect(args.take).toBe(1000);
      expect(args.orderBy).toEqual({ id: 'asc' });
      expect(result).toEqual([{ id: 'a', locationLat: 18.5, locationLng: 73.8, workExperiences: [], company: null }]);
    });

    it('flattens the current company and rounds legacy precise coordinates to ~1 km', async () => {
      prismaMock.user.findMany.mockResolvedValue([
        mapRow({
          locationLat: new Prisma.Decimal('18.52137381'),
          locationLng: new Prisma.Decimal('73.85450712'),
          workExperiences: [{ company: 'Acme' }],
        }),
      ]);

      const [alumnus] = await userService.getAlumniLocations();

      expect(alumnus).toMatchObject({ locationLat: 18.52, locationLng: 73.85, company: 'Acme' });
      expect(LOCATION_PRECISION_DECIMALS).toBe(2);
    });

    it('applies bounds in the query', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await userService.getAlumniLocations({ north: 20, south: 10, east: 80, west: 70, limit: 50 });
      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.where.locationLat).toEqual({ not: null, gte: 10, lte: 20 });
      expect(args.where.locationLng).toEqual({ not: null, gte: 70, lte: 80 });
      expect(args.take).toBe(50);
    });

    it('handles bounds that cross the antimeridian without clobbering the search filter', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await userService.getAlumniLocations({ north: 10, south: -10, east: -170, west: 170, search: 'ann' });
      const { where } = prismaMock.user.findMany.mock.calls[0][0];
      expect(where.AND).toEqual([
        {
          OR: [
            { locationLng: { not: null, gte: 170 } },
            { locationLng: { not: null, lte: -170 } },
          ],
        },
      ]);
      expect(where.OR).toEqual([
        { fullName: { contains: 'ann', mode: 'insensitive' } },
        { city: { contains: 'ann', mode: 'insensitive' } },
      ]);
      expect(where.isLocationPublic).toBe(true);
    });

    it('filters by batch year and department', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await userService.getAlumniLocations({ batchYear: 2015, department: 'Computer' });
      const { where } = prismaMock.user.findMany.mock.calls[0][0];
      expect(where.batchYear).toBe(2015);
      expect(where.department).toEqual({ contains: 'Computer', mode: 'insensitive' });
    });

    it('caps the limit', async () => {
      prismaMock.user.findMany.mockResolvedValue([]);
      await userService.getAlumniLocations({ limit: 1_000_000 });
      expect(prismaMock.user.findMany.mock.calls[0][0].take).toBe(LOCATIONS_MAX_LIMIT);
    });
  });

  describe('getNearbyAlumni', () => {
    const rawCall = () => prismaMock.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    // Parameter order: earth radius, centreLat (x2), centreLng, minLat, maxLat, [minLng, maxLng], [filters], radius, limit
    const values = () => rawCall().values as unknown[];

    it('uses a bounded (bounding-box) PostgreSQL query with privacy filters', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);

      const result = await userService.getNearbyAlumni(19.07, 72.87, 50, 10);

      const sql = rawCall().sql;
      expect(sql).toMatch(/FROM "User" u/);
      expect(sql).toMatch(/u\."isActive" = true/);
      expect(sql).toMatch(/u\."isVerified" = true/);
      expect(sql).toMatch(/u\."isLocationPublic" = true/);
      expect(sql).toMatch(/u\."locationLat" BETWEEN \?::float8 AND \?::float8/);
      expect(sql).toMatch(/u\."locationLng" BETWEEN \?::float8 AND \?::float8/);
      expect(sql).toMatch(/ASIN\(LEAST\(1, SQRT/);
      expect(sql).toMatch(/ORDER BY "distanceKm", id/);
      expect(sql).toMatch(/LIMIT \?/);
      expect(sql).not.toMatch(/phoneNumber|email|ST_Distance_Sphere/);

      const [, , , , minLat, maxLat, minLng, maxLng, radiusKm, limit] = values() as number[];
      expect(minLat).toBeLessThan(19.07 - 50 / 111.7);
      expect(maxLat).toBeGreaterThan(19.07 + 50 / 111.7);
      expect(maxLat - minLat).toBeLessThan(1); // ~0.9°: genuinely bounded
      expect(minLng).toBeLessThan(72.87);
      expect(maxLng).toBeGreaterThan(72.87);
      expect(maxLng - minLng).toBeLessThan(1.2);
      expect(radiusKm).toBe(50);
      expect(limit).toBe(10);

      expect(result).toEqual({ count: 0, centerLat: 19.07, centerLng: 72.87, radiusKm: 50, alumni: [] });
      expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    });

    it('caps radius and limit', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const result = await userService.getNearbyAlumni(19, 72, 100_000, 100_000);
      const v = values();
      expect(v[v.length - 2]).toBe(NEARBY_MAX_RADIUS_KM);
      expect(v[v.length - 1]).toBe(NEARBY_MAX_LIMIT);
      expect(result.radiusKm).toBe(NEARBY_MAX_RADIUS_KM);
    });

    it('falls back to defaults for non-positive radius / limit', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const result = await userService.getNearbyAlumni(19, 72, -5, 0);
      const v = values();
      expect(result.radiusKm).toBe(50);
      expect(v[v.length - 1]).toBe(1);
    });

    it('adds batch, department and name/city filters as bound parameters with LIKE wildcards escaped', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      await userService.getNearbyAlumni(19, 72, 50, 10, { batchYear: 2012, department: 'Mech', search: '50%_off' });

      const sql = rawCall().sql;
      expect(sql).toMatch(/AND u\."batchYear" = \?/);
      expect(sql).toMatch(/AND u\."department" ILIKE \?/);
      expect(sql).toMatch(/AND \(u\."fullName" ILIKE \? OR u\."city" ILIKE \?\)/);
      expect(values()).toEqual(expect.arrayContaining([2012, '%Mech%', '%50\\%\\_off%']));
      expect(sql).not.toMatch(/Mech|50%/);
    });

    it('splits the longitude range across the antimeridian', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      await userService.getNearbyAlumni(0, 179.9, 50);
      expect(rawCall().sql).toMatch(/\(u\."locationLng" >= \?::float8 OR u\."locationLng" <= \?::float8\)/);
      const east = values() as number[];
      expect(east[6]).toBeGreaterThan(179);
      expect(east[7]).toBeLessThan(-179);

      prismaMock.$queryRaw.mockClear();
      await userService.getNearbyAlumni(0, -179.9, 50);
      const west = values() as number[];
      expect(west[6]).toBeGreaterThan(179);
      expect(west[7]).toBeLessThan(-179);
    });

    it('drops the longitude restriction near the poles', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      await userService.getNearbyAlumni(89.9, 10, 50);
      expect(rawCall().sql).toMatch(/"locationLat" BETWEEN/);
      expect(rawCall().sql).not.toMatch(/"locationLng" BETWEEN|"locationLng" >=/);
    });

    it('drops the longitude restriction when the box would span the globe', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      await userService.getNearbyAlumni(85, 10, 500);
      expect(rawCall().sql).not.toMatch(/"locationLng" BETWEEN|"locationLng" >=/);
    });

    it.each([
      [91, 0],
      [-91, 0],
      [0, 181],
      [Number.NaN, 0],
    ])('rejects invalid centre (%s, %s)', async (lat, lng) => {
      await expect(userService.getNearbyAlumni(lat, lng)).rejects.toMatchObject({ statusCode: 400 });
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });

    it('hydrates users in distance order and re-applies privacy filters', async () => {
      prismaMock.$queryRaw.mockResolvedValue([
        { id: 'near', distanceKm: 1.234 },
        { id: 'gone', distanceKm: 2 },
        { id: 'far', distanceKm: '12.06' },
      ]);
      prismaMock.user.findMany.mockResolvedValue([
        { id: 'far', locationLat: new Prisma.Decimal(1), locationLng: new Prisma.Decimal(2), workExperiences: [] },
        {
          id: 'near',
          locationLat: new Prisma.Decimal(3),
          locationLng: new Prisma.Decimal(4),
          workExperiences: [{ company: 'Acme' }],
        },
      ]);

      const result = await userService.getNearbyAlumni(19, 72);

      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ id: { in: ['near', 'gone', 'far'] }, isActive: true, isLocationPublic: true });
      expect(args.select.email).toBeUndefined();
      expect(args.select.phoneNumber).toBeUndefined();
      expect(result.count).toBe(2);
      expect(result.alumni).toEqual([
        { id: 'near', locationLat: 3, locationLng: 4, workExperiences: [{ company: 'Acme' }], company: 'Acme', distanceKm: 1.2 },
        { id: 'far', locationLat: 1, locationLng: 2, workExperiences: [], company: null, distanceKm: 12.1 },
      ]);
    });
  });

  describe('getPublicStats', () => {
    it('counts only active, verified members', async () => {
      prismaMock.user.count.mockResolvedValue(42);
      prismaMock.user.groupBy
        .mockResolvedValueOnce([{ batchYear: 2010 }, { batchYear: 2011 }])
        .mockResolvedValueOnce([{ city: 'Pune' }]);
      prismaMock.workExperience.groupBy.mockResolvedValue([{ company: 'A' }, { company: 'B' }, { company: 'C' }]);

      const stats = await userService.getPublicStats();

      expect(stats).toEqual({ totalAlumni: 42, totalBatches: 2, totalCompanies: 3, totalCities: 1 });
      const visible = { isActive: true, isVerified: true };
      expect(prismaMock.user.count).toHaveBeenCalledWith({ where: visible });
      expect(prismaMock.user.groupBy.mock.calls[0][0].where).toEqual(visible);
      expect(prismaMock.user.groupBy.mock.calls[1][0].where).toEqual({ ...visible, city: { not: null } });
      expect(prismaMock.workExperience.groupBy.mock.calls[0][0].where).toEqual({ user: visible });
    });
  });

  describe('getNotableAlumni', () => {
    it('returns notable, active, verified alumni without private fields', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'n1' }]);

      await expect(userService.getNotableAlumni(3)).resolves.toEqual([{ id: 'n1' }]);

      const args = prismaMock.user.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ isNotable: true, isActive: true, isVerified: true });
      expect(args.take).toBe(3);
      expect(args.select.email).toBeUndefined();
      expect(args.select.phoneNumber).toBeUndefined();
    });

    it('caps and normalises the limit', async () => {
      prismaMock.user.findMany.mockResolvedValue([{ id: 'n1' }]);
      await userService.getNotableAlumni(10_000);
      expect(prismaMock.user.findMany.mock.calls[0][0].take).toBe(NOTABLE_MAX_LIMIT);
      await userService.getNotableAlumni(-1);
      expect(prismaMock.user.findMany.mock.calls[1][0].take).toBe(1);
      await userService.getNotableAlumni(Number.NaN);
      expect(prismaMock.user.findMany.mock.calls[2][0].take).toBe(6);
    });

    it('falls back to the most complete profiles when nobody is flagged notable', async () => {
      prismaMock.user.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'f1' }]);

      await expect(userService.getNotableAlumni()).resolves.toEqual([{ id: 'f1' }]);

      const fallback = prismaMock.user.findMany.mock.calls[1][0];
      expect(fallback.where).toEqual({ isActive: true, isVerified: true, profilePhotoUrl: { not: null } });
      expect(fallback.take).toBe(6);
    });

    it('falls back when the notable query fails', async () => {
      prismaMock.user.findMany.mockRejectedValueOnce(new Error('Unknown column')).mockResolvedValueOnce([{ id: 'f1' }]);
      await expect(userService.getNotableAlumni()).resolves.toEqual([{ id: 'f1' }]);
    });
  });

  describe('updateProfilePhoto / updateCoverPhoto', () => {
    const existingPhotos = {
      id: OWNER,
      profilePhotoUrl: '/uploads/profiles/old.jpg',
      coverPhotoUrl: '/uploads/covers/old.jpg',
      shortBio: null,
      city: null,
      linkedinUrl: null,
      currentDesignation: null,
    };

    it('saves the first photo with a safe projection and recomputes completeness', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...existingPhotos, profilePhotoUrl: null });
      prismaMock.user.update.mockResolvedValue({ id: OWNER, profilePhotoUrl: '/uploads/profiles/new.jpg' });

      await userService.updateProfilePhoto(OWNER, '/uploads/profiles/new.jpg');

      const args = prismaMock.user.update.mock.calls[0][0];
      expect(args.data).toEqual({ profilePhotoUrl: '/uploads/profiles/new.jpg', profileCompleteness: 40 });
      expect(args.select).toBeDefined();
      expect(args.select.passwordHash).toBeUndefined();
      expect(deleteFromStorage).not.toHaveBeenCalled();
    });

    it('deletes the previous profile photo after a successful update', async () => {
      prismaMock.user.findUnique.mockResolvedValue(existingPhotos);
      prismaMock.user.update.mockResolvedValue({ id: OWNER });

      await userService.updateProfilePhoto(OWNER, '/uploads/profiles/new.jpg');

      expect(deleteFromStorage).toHaveBeenCalledWith('/uploads/profiles/old.jpg');
      expect(prismaMock.user.update.mock.invocationCallOrder[0]).toBeLessThan(
        (deleteFromStorage as jest.Mock).mock.invocationCallOrder[0]
      );
    });

    it('does not fail the request if deleting the old file fails', async () => {
      prismaMock.user.findUnique.mockResolvedValue(existingPhotos);
      prismaMock.user.update.mockResolvedValue({ id: OWNER, coverPhotoUrl: '/uploads/covers/new.jpg' });
      (deleteFromStorage as jest.Mock).mockRejectedValueOnce(new Error('S3 down'));

      await expect(userService.updateCoverPhoto(OWNER, '/uploads/covers/new.jpg')).resolves.toEqual({
        id: OWNER,
        coverPhotoUrl: '/uploads/covers/new.jpg',
      });
      expect(deleteFromStorage).toHaveBeenCalledWith('/uploads/covers/old.jpg');
      expect(prismaMock.user.update.mock.calls[0][0].data).toEqual({
        coverPhotoUrl: '/uploads/covers/new.jpg',
        profileCompleteness: 40,
      });
    });

    it('does not delete when the URL is unchanged', async () => {
      prismaMock.user.findUnique.mockResolvedValue(existingPhotos);
      prismaMock.user.update.mockResolvedValue({ id: OWNER });
      await userService.updateCoverPhoto(OWNER, '/uploads/covers/old.jpg');
      expect(deleteFromStorage).not.toHaveBeenCalled();
    });

    it('404s for a missing user without uploading over anything', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      await expect(userService.updateProfilePhoto(OWNER, '/uploads/profiles/new.jpg')).rejects.toMatchObject({
        statusCode: 404,
      });
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });
  });
});
