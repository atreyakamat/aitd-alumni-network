/**
 * Environment-dependent defaults of src/config. Each case loads the module fresh with a controlled environment.
 */
const STRONG = 'k3Yp9sQ2vB7xN4mT8wZ1cR6dF5gH0jLaE3uI9oPqYtVn';

const loadConfig = (env: Record<string, string | undefined>) => {
  const saved = { ...process.env };
  for (const key of ['NODE_ENV', 'REQUIRE_EMAIL_VERIFICATION', 'JWT_EXPIRES_IN', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) delete process.env[key];
  Object.assign(process.env, { JWT_SECRET: STRONG, JWT_REFRESH_SECRET: `${STRONG}-refresh`, ...env });
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete process.env[key];
  try {
    let loaded!: typeof import('../../config');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      loaded = require('../../config');
    });
    return loaded.config;
  } finally {
    process.env = saved;
  }
};

describe('auth.requireEmailVerification', () => {
  it('is on in production and off in development and tests unless asked for', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).auth.requireEmailVerification).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development' }).auth.requireEmailVerification).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test' }).auth.requireEmailVerification).toBe(false);
  });

  it('can be switched either way explicitly', () => {
    expect(loadConfig({ NODE_ENV: 'development', REQUIRE_EMAIL_VERIFICATION: 'true' }).auth.requireEmailVerification).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: 'false' }).auth.requireEmailVerification).toBe(false);
  });

  it('treats an empty value as unset (docker-compose passes unset variables as empty strings), so production stays secure', () => {
    expect(loadConfig({ NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: '' }).auth.requireEmailVerification).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', REQUIRE_EMAIL_VERIFICATION: '  ' }).auth.requireEmailVerification).toBe(true);
    expect(loadConfig({ NODE_ENV: 'development', REQUIRE_EMAIL_VERIFICATION: '' }).auth.requireEmailVerification).toBe(false);
  });
});

describe('jwt.expiresIn', () => {
  it('defaults to a short access token in production and a day elsewhere', () => {
    expect(loadConfig({ NODE_ENV: 'production' }).jwt.expiresIn).toBe('15m');
    expect(loadConfig({ NODE_ENV: 'development' }).jwt.expiresIn).toBe('24h');
  });

  it('honours an explicit setting', () => {
    expect(loadConfig({ NODE_ENV: 'production', JWT_EXPIRES_IN: '30m' }).jwt.expiresIn).toBe('30m');
  });
});
