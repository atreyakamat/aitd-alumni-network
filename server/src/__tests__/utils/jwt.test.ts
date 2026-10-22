import jwt from 'jsonwebtoken';
import {
  generateAccessToken,
  generateRefreshToken,
  generateTwoFactorToken,
  hashToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyTwoFactorToken,
} from '../../utils/jwt';
import { comparePassword, hashPassword } from '../../utils/password';
import { config } from '../../config';

describe('utils/jwt', () => {
  it('round-trips an access token with id, email and role', () => {
    const token = generateAccessToken('u1', 'a@b.io', 'ADMIN');
    expect(verifyAccessToken(token)).toMatchObject({ userId: 'u1', email: 'a@b.io', userRole: 'ADMIN' });
  });

  it('embeds the token version (tv) claim, defaulting to 0', () => {
    expect(verifyAccessToken(generateAccessToken('u1', 'a@b.io', 'ADMIN')).tv).toBe(0);
    expect(verifyAccessToken(generateAccessToken('u1', 'a@b.io', 'ADMIN', 5)).tv).toBe(5);
  });

  it('issues unique refresh tokens even within the same second (jti)', () => {
    const a = generateRefreshToken('u1');
    const b = generateRefreshToken('u1');
    expect(a).not.toEqual(b);
    expect(verifyRefreshToken(a).userId).toBe('u1');
    expect((jwt.decode(a) as any).jti).toEqual(expect.any(String));
  });

  it('does not accept a refresh token as an access token or vice versa', () => {
    expect(() => verifyAccessToken(generateRefreshToken('u1'))).toThrow(jwt.JsonWebTokenError);
    expect(() => verifyRefreshToken(generateAccessToken('u1', 'a@b.io', 'MEMBER'))).toThrow(jwt.JsonWebTokenError);
  });

  it('rejects tokens signed with a different algorithm (alg pinning)', () => {
    const forged = jwt.sign({ userId: 'u1', email: 'x', userRole: 'SUPER_ADMIN' }, config.jwt.secret, { algorithm: 'HS512' });
    expect(() => verifyAccessToken(forged)).toThrow(/invalid algorithm/);
  });

  it('rejects unsigned (alg=none) tokens', () => {
    const unsigned = jwt.sign({ userId: 'u1' }, '', { algorithm: 'none' } as any);
    expect(() => verifyAccessToken(unsigned)).toThrow(jwt.JsonWebTokenError);
  });

  it('surfaces expiry as TokenExpiredError', () => {
    const expired = jwt.sign({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 10 }, config.jwt.secret);
    expect(() => verifyAccessToken(expired)).toThrow(jwt.TokenExpiredError);
  });

  describe('2FA challenge token', () => {
    it('round-trips the user id', () => {
      expect(verifyTwoFactorToken(generateTwoFactorToken('u1'))).toEqual({ userId: 'u1' });
    });

    it('cannot be used as an access token', () => {
      expect(() => verifyAccessToken(generateTwoFactorToken('u1'))).toThrow(jwt.JsonWebTokenError);
    });

    it('rejects access tokens and tokens without the 2FA purpose', () => {
      expect(() => verifyTwoFactorToken(generateAccessToken('u1', 'a@b.io', 'MEMBER'))).toThrow();
    });

    it('rejects a correctly-keyed token with the wrong purpose', () => {
      // Reproduce the derived key to prove the purpose claim is enforced independently of the signature
      const crypto = jest.requireActual('crypto');
      const key = crypto.createHmac('sha256', config.jwt.secret).update('2fa-challenge').digest('hex');
      expect(() => verifyTwoFactorToken(jwt.sign({ userId: 'u1', purpose: 'other' }, key))).toThrow(/invalid 2FA/);
      expect(() => verifyTwoFactorToken(jwt.sign({ purpose: '2fa-challenge' }, key))).toThrow(/invalid 2FA/);
    });
  });

  it('hashToken is a deterministic sha256 hex digest that hides the input', () => {
    const h = hashToken('secret-token');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).toBe(hashToken('secret-token'));
    expect(h).not.toContain('secret-token');
    expect(hashToken('other')).not.toBe(h);
  });
});

describe('utils/password', () => {
  it('hashes with bcrypt and verifies correctly', async () => {
    const hash = await hashPassword('Correct#Pass1');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).not.toContain('Correct#Pass1');
    await expect(comparePassword('Correct#Pass1', hash)).resolves.toBe(true);
    await expect(comparePassword('wrong', hash)).resolves.toBe(false);
  });
});
