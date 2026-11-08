/**
 * server/src/config/index.ts:
 *   secret: process.env.JWT_SECRET || 'default-secret-change-me'
 *   refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-me'
 *
 * These fallback strings are plaintext in the public source tree. If a
 * non-production deployment (NODE_ENV !== 'production', e.g. a forgotten
 * .env on a demo/staging box) boots without JWT_SECRET set, every access
 * token is signed with a secret anyone can read from this repository —
 * trivial full account-takeover / admin impersonation by forging a token.
 *
 * This test loads server/src/config in isolation with JWT_SECRET deleted
 * (jest.isolateModules), independent of the global test harness's
 * JWT_SECRET (set in tests/env.ts) and independent of the live local
 * instance (which DOES have a strong JWT_SECRET in server/.env — not
 * reachable/affected by this test).
 */
import jwt from 'jsonwebtoken';

const KNOWN_DEFAULT_SECRET = 'default-secret-change-me';

describe('JWT default secret fallback', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('[VULNERABLE] falls back to a hardcoded, source-visible secret when JWT_SECRET is unset outside production', () => {
    let loadedSecret = '';
    jest.isolateModules(() => {
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = 'development';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const freshConfig = require('../../../src/config').config;
      loadedSecret = freshConfig.jwt.secret;
    });

    // SECURE expectation: the app should refuse to start, or generate a
    // random per-boot secret, rather than fall back to a value published in
    // its own source code.
    expect(loadedSecret).not.toBe(KNOWN_DEFAULT_SECRET);
  });

  it('[VULNERABLE] a token forged offline with the known default secret verifies successfully', () => {
    let loadedSecret = '';
    jest.isolateModules(() => {
      delete process.env.JWT_SECRET;
      process.env.NODE_ENV = 'development';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const freshConfig = require('../../../src/config').config;
      loadedSecret = freshConfig.jwt.secret;
    });

    // Attacker-side: forge a token using only the value published in
    // server/src/config/index.ts, with no access to the running server.
    const forged = jwt.sign(
      { userId: 'any-user-id', email: 'attacker@test.com', userRole: 'SUPER_ADMIN', tv: 0 },
      KNOWN_DEFAULT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    // Server-side: this is exactly what utils/jwt.ts#verifyAccessToken does
    // with the secret the server actually loaded.
    let verified = false;
    try {
      jwt.verify(forged, loadedSecret, { algorithms: ['HS256'] });
      verified = true;
    } catch {
      verified = false;
    }

    // SECURE expectation: a token forged against the known default must NOT verify.
    expect(verified).toBe(false);
  });
});
