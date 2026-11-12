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

    // R3-08: the deny-list compared raw characters, so a look-alike spelling of a listed password was accepted
    it.each([
      ['full-width letters and digits', '\uff30\uff41\uff53\uff53\uff57\uff4f\uff52\uff44\uff11'],
      ['accented letters', 'P\u00e1ssw\u00f6rd1'],
      ['decomposed accents (combining marks)', 'Pa\u0301ssword1'],
      ['a zero-width space inside', 'Pass\u200bword1'],
      ['a soft hyphen inside', 'Pass\u00adword123'],
      ['compatibility forms (ligature, long s)', 'Pa\u017f\u017fword1'],
      ['full-width trailing punctuation', 'Password1\uff01'],
      ['mixed case, accented, with trailing symbols', 'PASSW\u00d6RD123!!'],
    ])('rejects a look-alike of a listed password: %s (Unicode-normalised comparison)', (_label, pw) => {
      expect(() => assertPasswordAllowed(pw)).toThrow(expect.objectContaining({ statusCode: 400, code: 'WEAK_PASSWORD' }));
    });

    it('applies the same normalisation to the account e-mail rule', () => {
      expect(() => assertPasswordAllowed('Ada.Alum\uff12\uff10\uff12\uff10', 'ada.alum2020@aiem.edu')).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' }));
    });

    it('still accepts a legitimately non-ASCII password that is not a variant of a listed one', () => {
      expect(() => assertPasswordAllowed('Caf\u00e9-Nr1-\u00fcber-Lang')).not.toThrow();
      expect(() => assertPasswordAllowed('\u5bc6\u7801Strong99xyz')).not.toThrow();
    });

    it('does not change how a password is hashed or compared: an existing hash of a non-normalised password still verifies', async () => {
      const raw = 'Cafe\u0301-Nr1-Lang-xyz'; // decomposed e + accent
      const hash = await hashPassword(raw);
      await expect(comparePassword(raw, hash)).resolves.toBe(true);
      await expect(comparePassword(raw.normalize('NFC'), hash)).resolves.toBe(false);
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
