import { evaluateProductionConfig, findProductionProblems, LEAKED_DB_PASSWORDS } from '../../config/productionChecks';

const STRONG_A = 'k3Yp9sQ2vB7xN4mT8wZ1cR6dF5gH0jLaE3uI9oPqYtVn';
const STRONG_B = 'Zr8Wm2Ls6Qa0Xc4Vb9Nd1Hf7Tg3Ju5Ky2Ep8RoUiMw6';

/** A configuration that passes every check, as a real deployment would have it. */
const good = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://aitd:7vQ2mX9pLr4TnB8cZk1Wd@postgres:5432/alumni_connect?schema=public',
  JWT_SECRET: STRONG_A,
  JWT_REFRESH_SECRET: STRONG_B,
  FRONTEND_URL: 'https://alumni.example.edu',
  CORS_ORIGINS: 'https://alumni.example.edu',
  SMTP_HOST: 'smtp.example.edu',
  SMTP_USER: 'mailer',
  SMTP_PASS: 'mailer-password',
  REDIS_URL: 'redis://redis:6379',
  KAFKA_BROKERS: 'kafka:9092',
  AWS_S3_BUCKET: 'aitd-uploads',
  TRUST_PROXY: '1',
  ...overrides,
});

const codes = (env: NodeJS.ProcessEnv) => findProductionProblems(env).map((p) => p.code);

describe('findProductionProblems', () => {
  it('reports nothing for a properly configured deployment', () => {
    expect(findProductionProblems(good())).toEqual([]);
  });

  describe('signing secrets', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['short', 'tooshort'],
      ['a published default', 'default-jwt-secret-change-me-please-xxxxxxxxxx'],
      ['an unedited placeholder', 'change-me-to-a-long-random-value-xxxxxxxxxxxxxxxx'],
      ['one repeated character', 'a'.repeat(48)],
    ])('rejects a JWT_SECRET that is %s', (_label, value) => {
      expect(codes(good({ JWT_SECRET: value }))).toContain('JWT_SECRET_WEAK');
    });

    it('rejects a weak refresh secret and a refresh secret equal to the access secret', () => {
      expect(codes(good({ JWT_REFRESH_SECRET: 'short' }))).toContain('JWT_REFRESH_SECRET_WEAK');
      expect(codes(good({ JWT_REFRESH_SECRET: STRONG_A }))).toContain('JWT_SECRETS_IDENTICAL');
    });

    it('is not waivable', () => {
      const result = evaluateProductionConfig({ ...good({ JWT_SECRET: 'short' }), ALLOW_INSECURE_PRODUCTION_CONFIG: 'true' });
      expect(result.errors.map((e) => e.code)).toContain('JWT_SECRET_WEAK');
    });
  });

  describe('database', () => {
    it('rejects the password that was committed to the repository (encoded or not)', () => {
      for (const leaked of LEAKED_DB_PASSWORDS) {
        const plain = `postgresql://u:${leaked}@db:5432/x`;
        const encoded = `postgresql://u:${encodeURIComponent(leaked)}@db:5432/x`;
        expect(codes(good({ DATABASE_URL: plain }))).toContain('DB_PASSWORD_LEAKED');
        expect(codes(good({ DATABASE_URL: encoded }))).toContain('DB_PASSWORD_LEAKED');
      }
    });

    it.each([
      ['empty', 'postgresql://aitd:@postgres:5432/x'],
      ['absent', 'postgresql://aitd@postgres:5432/x'],
      ['postgres', 'postgresql://postgres:postgres@postgres:5432/x'],
      ['a placeholder', 'postgresql://aitd:change-me-postgres-password@postgres:5432/x'],
      ['short', 'postgresql://aitd:abc123@postgres:5432/x'],
    ])('rejects a %s database password', (_label, url) => {
      expect(codes(good({ DATABASE_URL: url }))).toContain('DB_PASSWORD_WEAK');
    });

    it('is not waivable', () => {
      const result = evaluateProductionConfig({ ...good({ DATABASE_URL: 'postgresql://postgres:postgres@db/x' }), ALLOW_INSECURE_PRODUCTION_CONFIG: 'true' });
      expect(result.errors.map((e) => e.code)).toContain('DB_PASSWORD_WEAK');
    });
  });

  it('refuses to run with rate limiting switched off', () => {
    expect(codes(good({ DISABLE_RATE_LIMIT: 'true' }))).toContain('RATE_LIMIT_DISABLED');
  });

  describe('origins', () => {
    it.each([
      ['localhost', 'http://localhost:3000'],
      ['loopback', 'https://127.0.0.1'],
      ['plain http', 'http://alumni.example.edu'],
      ['a wildcard', '*'],
      ['a list with one bad entry', 'https://alumni.example.edu,http://localhost:3000'],
    ])('rejects CORS_ORIGINS containing %s', (_label, value) => {
      expect(codes(good({ CORS_ORIGINS: value }))).toContain('CORS_ORIGINS_INSECURE');
    });

    it('rejects an insecure or missing FRONTEND_URL', () => {
      expect(codes(good({ FRONTEND_URL: 'http://localhost:3000' }))).toContain('FRONTEND_URL_INSECURE');
      expect(codes(good({ FRONTEND_URL: undefined }))).toContain('FRONTEND_URL_INSECURE');
    });

    it('can be waived for a trial run on one machine, and then only warns', () => {
      const env = { ...good({ CORS_ORIGINS: 'http://localhost:3000', FRONTEND_URL: 'http://localhost:3000' }), ALLOW_INSECURE_PRODUCTION_CONFIG: 'true' };
      const result = evaluateProductionConfig(env);
      expect(result.errors).toEqual([]);
      expect(result.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['CORS_ORIGINS_INSECURE', 'FRONTEND_URL_INSECURE', 'INSECURE_WAIVER_ACTIVE']));
    });
  });

  describe('e-mail', () => {
    it('requires working outbound mail while e-mail verification is enforced (the default in production)', () => {
      expect(codes(good({ SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined }))).toContain('EMAIL_NOT_CONFIGURED');
    });

    it('accepts SendGrid instead of SMTP', () => {
      expect(codes(good({ SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, SENDGRID_API_KEY: 'SG.xxxxxxxx' }))).not.toContain('EMAIL_NOT_CONFIGURED');
    });

    it('does not insist on mail when verification has been switched off on purpose', () => {
      expect(codes(good({ SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, REQUIRE_EMAIL_VERIFICATION: 'false' }))).not.toContain('EMAIL_NOT_CONFIGURED');
    });

    it('warns that switching verification off weakens account security', () => {
      expect(codes(good({ REQUIRE_EMAIL_VERIFICATION: 'false' }))).toContain('EMAIL_VERIFICATION_OFF');
    });
  });

  describe('payments', () => {
    it('needs the webhook secret as soon as a Razorpay key is set (without it payments never complete)', () => {
      expect(codes(good({ RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's' }))).toContain('RAZORPAY_WEBHOOK_SECRET_MISSING');
      expect(codes(good({ RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'whsec' }))).not.toContain('RAZORPAY_WEBHOOK_SECRET_MISSING');
    });

    it('warns about test-mode keys', () => {
      expect(codes(good({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' }))).toContain('RAZORPAY_TEST_KEYS');
    });
  });

  it('rejects sample data seeding in production', () => {
    expect(codes(good({ SEED_SAMPLE_DATA: 'true' }))).toContain('SEED_SAMPLE_DATA_ON');
  });

  describe('warnings (the deployment works, but it is weaker than it should be)', () => {
    it('flags a missing Redis, local-disk uploads, an open trust-proxy setting and long-lived access tokens', () => {
      const found = codes(good({ REDIS_URL: undefined, AWS_S3_BUCKET: undefined, TRUST_PROXY: '0', JWT_EXPIRES_IN: '24h' }));
      expect(found).toEqual(expect.arrayContaining(['REDIS_MISSING', 'UPLOADS_ON_LOCAL_DISK', 'TRUST_PROXY_NONE', 'JWT_EXPIRES_TOO_LONG']));
    });

    it('accepts short access tokens in any unit', () => {
      for (const value of ['15m', '900s', '1h', '30m']) {
        expect(codes(good({ JWT_EXPIRES_IN: value }))).not.toContain('JWT_EXPIRES_TOO_LONG');
      }
      expect(codes(good({ JWT_EXPIRES_IN: '2h' }))).toContain('JWT_EXPIRES_TOO_LONG');
      expect(codes(good({ JWT_EXPIRES_IN: '7d' }))).toContain('JWT_EXPIRES_TOO_LONG');
    });

    it('warns about a short seed admin password', () => {
      expect(codes(good({ SEED_ADMIN_PASSWORD: 'Short#1' }))).toContain('SEED_ADMIN_PASSWORD_WEAK');
    });
  });
});

describe('evaluateProductionConfig', () => {
  it('splits errors from warnings', () => {
    const result = evaluateProductionConfig(good({ REDIS_URL: undefined, JWT_SECRET: 'short' }));
    expect(result.errors.map((e) => e.code)).toEqual(['JWT_SECRET_WEAK']);
    expect(result.warnings.map((w) => w.code)).toContain('REDIS_MISSING');
    expect(result.ok).toBe(false);
  });

  it('is ok when there are only warnings', () => {
    expect(evaluateProductionConfig(good({ REDIS_URL: undefined })).ok).toBe(true);
  });

  it('gives every finding a message that says what to do', () => {
    const result = evaluateProductionConfig({ NODE_ENV: 'production' });
    expect(result.errors.length).toBeGreaterThan(3);
    for (const finding of [...result.errors, ...result.warnings]) {
      expect(finding.message.length).toBeGreaterThan(20);
      expect(finding.fix.length).toBeGreaterThan(10);
    }
  });
});
