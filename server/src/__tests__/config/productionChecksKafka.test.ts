import { findProductionProblems } from '../../config/productionChecks';

const STRONG_A = 'k3Yp9sQ2vB7xN4mT8wZ1cR6dF5gH0jLaE3uI9oPqYtVn';
const STRONG_B = 'Zr8Wm2Ls6Qa0Xc4Vb9Nd1Hf7Tg3Ju5Ky2Ep8RoUiMw6';

/** A configuration that passes every check, with the notification broker configured. */
const good = (overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://aiem:7vQ2mX9pLr4TnB8cZk1Wd@postgres:5432/alumni_connect?schema=public',
  JWT_SECRET: STRONG_A,
  JWT_REFRESH_SECRET: STRONG_B,
  FRONTEND_URL: 'https://alumni.example.edu',
  CORS_ORIGINS: 'https://alumni.example.edu',
  SMTP_HOST: 'smtp.example.edu',
  SMTP_USER: 'mailer',
  SMTP_PASS: 'mailer-password',
  REDIS_URL: 'redis://redis:6379',
  KAFKA_BROKERS: 'kafka:9092',
  AWS_S3_BUCKET: 'aiem-uploads',
  TRUST_PROXY: '1',
  ...overrides,
});

const find = (env: NodeJS.ProcessEnv, code: string) => findProductionProblems(env).find((p) => p.code === code);

describe('notification delivery (Kafka and the college administrator\'s e-mail)', () => {
  it('a deployment with the broker and a mail server has nothing to report', () => {
    expect(findProductionProblems(good())).toEqual([]);
  });

  it('warns, but does not refuse to start, when no broker is configured: events are delivered in-process', () => {
    const problem = find(good({ KAFKA_BROKERS: undefined }), 'KAFKA_MISSING');
    expect(problem).toMatchObject({ level: 'warning' });
    expect(problem!.message).toMatch(/in-process/i);
    expect(problem!.fix).toMatch(/KAFKA_BROKERS/);
  });

  it.each([
    ['a broker without a port', { KAFKA_BROKERS: 'kafka' }],
    ['a SASL mechanism without credentials', { KAFKA_SASL_MECHANISM: 'plain' }],
    ['an unknown SASL mechanism', { KAFKA_SASL_MECHANISM: 'kerberos', KAFKA_SASL_USERNAME: 'u', KAFKA_SASL_PASSWORD: 'p' }],
    ['a topic prefix Kafka would reject', { KAFKA_TOPIC_PREFIX: 'bad prefix!' }],
  ])('refuses to start with %s', (_label, overrides) => {
    const problem = find(good(overrides), 'KAFKA_CONFIG_INVALID');
    expect(problem).toMatchObject({ level: 'error' });
    expect(problem!.message).toMatch(/KAFKA_/);
  });

  it('does not judge Kafka settings when no broker is set (they are not used)', () => {
    expect(find(good({ KAFKA_BROKERS: undefined, KAFKA_SASL_MECHANISM: 'plain' }), 'KAFKA_CONFIG_INVALID')).toBeUndefined();
  });

  it('warns about an address in APPROVAL_NOTIFY_EMAIL that is not a mailbox (the college office would never hear about registrations)', () => {
    const problem = find(good({ APPROVAL_NOTIFY_EMAIL: 'alumni-office@college.edu, office-at-college' }), 'APPROVAL_NOTIFY_EMAIL_INVALID');
    expect(problem).toMatchObject({ level: 'warning' });
    expect(problem!.message).toContain('office-at-college');
  });

  it('accepts a list of good addresses and an empty value', () => {
    expect(find(good({ APPROVAL_NOTIFY_EMAIL: 'a@college.edu, b@college.edu' }), 'APPROVAL_NOTIFY_EMAIL_INVALID')).toBeUndefined();
    expect(find(good({ APPROVAL_NOTIFY_EMAIL: '' }), 'APPROVAL_NOTIFY_EMAIL_INVALID')).toBeUndefined();
  });
});
