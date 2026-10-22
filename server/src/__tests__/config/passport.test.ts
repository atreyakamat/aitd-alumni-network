import { oauthVerify, resolveOAuthUser } from '../../config/passport';
import { prismaMock } from '../../../tests/helpers';

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: 'prov-123',
  displayName: 'Ada Alum',
  emails: [{ value: '  Ada@AITD.edu ', verified: true }],
  photos: [{ value: 'https://img/ada.png' }],
  ...overrides,
});

const existing = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'ada@aitd.edu',
  fullName: 'Ada Alum',
  profilePhotoUrl: null,
  linkedinUrl: null,
  isActive: true,
  ...overrides,
});

describe('config/passport', () => {
  describe('resolveOAuthUser', () => {
    it('links to an existing account by normalised email', async () => {
      prismaMock.user.findUnique.mockResolvedValue(existing());
      await expect(resolveOAuthUser('google', profile())).resolves.toEqual({
        id: 'u1',
        email: 'ada@aitd.edu',
        fullName: 'Ada Alum',
        profilePhotoUrl: undefined,
        isNewUser: false,
      });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({ where: { email: 'ada@aitd.edu' } });
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('creates a password-less MEMBER for a new Google user', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(existing({ id: 'new', profilePhotoUrl: 'https://img/ada.png' }));

      const result = await resolveOAuthUser('google', profile());

      const data = prismaMock.user.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        email: 'ada@aitd.edu',
        fullName: 'Ada Alum',
        profilePhotoUrl: 'https://img/ada.png',
        passwordHash: '',
        isActive: true,
        isVerified: false,
        roleType: 'ALUMNI',
        userRole: 'MEMBER',
        department: 'Not Specified',
        degree: 'Not Specified',
        batchYear: new Date().getFullYear(),
      });
      expect(data.emailVerifiedAt).toBeInstanceOf(Date);
      expect(data.linkedinUrl).toBeUndefined();
      expect(result).toMatchObject({ id: 'new', isNewUser: true, profilePhotoUrl: 'https://img/ada.png' });
    });

    it('never lets the provider choose a privileged role', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(existing());
      await resolveOAuthUser('google', profile({ userRole: 'SUPER_ADMIN' } as any));
      expect(prismaMock.user.create.mock.calls[0][0].data.userRole).toBe('MEMBER');
    });

    it('falls back to the email local-part for the name', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(existing());
      await resolveOAuthUser('google', profile({ displayName: '' }));
      expect(prismaMock.user.create.mock.calls[0][0].data.fullName).toBe('ada');
    });

    it('creates LinkedIn users with a composed name and LinkedIn URL', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(existing());
      await resolveOAuthUser('linkedin', profile({ displayName: '', name: { givenName: 'Ada', familyName: 'Lovelace' } }));
      expect(prismaMock.user.create.mock.calls[0][0].data).toMatchObject({
        fullName: 'Ada Lovelace',
        linkedinUrl: 'https://linkedin.com/in/prov-123',
      });
    });

    it('LinkedIn falls back to the email local-part when no name parts exist', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.user.create.mockResolvedValue(existing());
      await resolveOAuthUser('linkedin', profile({ displayName: '', name: {} }));
      expect(prismaMock.user.create.mock.calls[0][0].data.fullName).toBe('ada');
    });

    it('back-fills the LinkedIn URL on an existing account only when missing', async () => {
      prismaMock.user.findUnique.mockResolvedValueOnce(existing());
      await resolveOAuthUser('linkedin', profile());
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { linkedinUrl: 'https://linkedin.com/in/prov-123' },
      });

      prismaMock.user.update.mockClear();
      prismaMock.user.findUnique.mockResolvedValueOnce(existing({ linkedinUrl: 'https://linkedin.com/in/custom' }));
      await resolveOAuthUser('linkedin', profile());
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it.each([
      ['google', 'No email found in Google profile'],
      ['linkedin', 'No email found in LinkedIn profile'],
    ] as const)('%s: rejects profiles without an email', async (provider, message) => {
      await expect(resolveOAuthUser(provider, profile({ emails: [] }))).rejects.toThrow(message);
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it.each([false, 'false'])('refuses to link by an unverified provider email (verified=%p)', async (verified) => {
      await expect(resolveOAuthUser('google', profile({ emails: [{ value: 'victim@aitd.edu', verified }] }))).rejects.toThrow(
        'Google email is not verified'
      );
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    });

    it('accepts profiles that do not report verification at all', async () => {
      prismaMock.user.findUnique.mockResolvedValue(existing());
      await expect(resolveOAuthUser('linkedin', profile({ emails: [{ value: 'ada@aitd.edu' }] }))).resolves.toMatchObject({
        id: 'u1',
      });
    });
  });

  describe('oauthVerify', () => {
    it('hands the resolved user to passport', async () => {
      prismaMock.user.findUnique.mockResolvedValue(existing());
      const done = jest.fn();
      await oauthVerify('google')('at', 'rt', profile(), done);
      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ id: 'u1', isNewUser: false }));
    });

    it('reports failures to passport instead of throwing', async () => {
      const done = jest.fn();
      await oauthVerify('linkedin')('at', 'rt', profile({ emails: undefined }), done);
      expect(done).toHaveBeenCalledWith(expect.any(Error), undefined);
    });
  });

  describe('strategy registration', () => {
    const ENV_KEYS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'];
    afterEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));

    it('registers no strategies when providers are not configured', () => {
      jest.isolateModules(() => {
        const passport = require('passport');
        const use = jest.spyOn(passport, 'use');
        require('../../config/passport');
        expect(use).not.toHaveBeenCalled();
      });
    });

    it('registers Google and LinkedIn when credentials exist', () => {
      ENV_KEYS.forEach((k) => (process.env[k] = `test-${k}`));
      jest.isolateModules(() => {
        const passport = require('passport');
        const use = jest.spyOn(passport, 'use').mockImplementation(() => passport);
        require('../../config/passport');
        const names = use.mock.calls.map((call: any[]) => call[0].name);
        expect(names).toEqual(['google', 'linkedin']);
      });
    });

    it('serialises the stateless user as-is', () => {
      jest.isolateModules(() => {
        const passport = require('passport');
        const serialize = jest.spyOn(passport, 'serializeUser');
        const deserialize = jest.spyOn(passport, 'deserializeUser');
        require('../../config/passport');
        const done = jest.fn();
        (serialize.mock.calls[0][0] as any)({ id: 'u1' }, done);
        (deserialize.mock.calls[0][0] as any)({ id: 'u1' }, done);
        expect(done).toHaveBeenNthCalledWith(1, null, { id: 'u1' });
        expect(done).toHaveBeenNthCalledWith(2, null, { id: 'u1' });
      });
    });
  });
});
