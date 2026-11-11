import bcrypt from 'bcryptjs';
import { assertPasswordAllowed, comparePassword, hashPassword, MAX_PASSWORD_BYTES } from '../../utils/password';

describe('utils/password', () => {
  it('hashes and verifies a normal password', async () => {
    const hash = await hashPassword('Str0ng!Passw0rd');
    await expect(comparePassword('Str0ng!Passw0rd', hash)).resolves.toBe(true);
    await expect(comparePassword('Str0ng!Passw0rd2', hash)).resolves.toBe(false);
  });

  describe('AU-06: bcrypt 72-byte truncation', () => {
    it('refuses to hash more than 72 bytes instead of silently ignoring the tail', async () => {
      await expect(hashPassword('A1'.repeat(37))).rejects.toMatchObject({ statusCode: 400, code: 'PASSWORD_TOO_LONG' });
      // 25 euro signs = 75 bytes but only 25 characters
      await expect(hashPassword('€'.repeat(25))).rejects.toMatchObject({ code: 'PASSWORD_TOO_LONG' });
      await expect(hashPassword('A'.repeat(MAX_PASSWORD_BYTES))).resolves.toEqual(expect.any(String));
    });

    it('does not hand oversized login attempts to bcrypt at all', async () => {
      const compare = jest.spyOn(bcrypt, 'compare');
      await expect(comparePassword('x'.repeat(5000), '$2a$04$abcdefghijklmnopqrstuuMwBsB1EqVYtB4A5nG8aqsV4G1tYzYuK')).resolves.toBe(false);
      expect(compare).not.toHaveBeenCalled();
      compare.mockRestore();
    });
  });

  describe('assertPasswordAllowed (AU-06)', () => {
    it.each(['Password1', 'password123!', 'Welcome123', 'Qwerty123#', 'Admin1234', 'P@ssw0rd', 'Aiem1234', 'AiemConnect1', 'Aitd1234'])(
      'rejects the breach-list staple %s',
      (pw) => {
        expect(() => assertPasswordAllowed(pw)).toThrow(expect.objectContaining({ statusCode: 400, code: 'WEAK_PASSWORD' }));
      }
    );

    it('rejects a password that is the account e-mail or its local part', () => {
      expect(() => assertPasswordAllowed('Ada.Alum2020', 'ada.alum2020@aiem.edu')).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
      expect(() => assertPasswordAllowed('ada.alum2020@aiem.edu', 'ada.alum2020@aiem.edu')).toThrow(
        expect.objectContaining({ code: 'WEAK_PASSWORD' })
      );
    });

    it('rejects passwords over 72 bytes with the specific code', () => {
      expect(() => assertPasswordAllowed('Ab1'.repeat(30))).toThrow(expect.objectContaining({ code: 'PASSWORD_TOO_LONG' }));
    });

    it('accepts ordinary strong passwords', () => {
      expect(() => assertPasswordAllowed('Str0ng!Passw0rd', 'a@b.co')).not.toThrow();
      expect(() => assertPasswordAllowed('Tr1cky-Horse-Battery', 'ada@aiem.edu')).not.toThrow();
    });
  });
});
