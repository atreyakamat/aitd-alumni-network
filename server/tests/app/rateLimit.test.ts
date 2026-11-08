import request from 'supertest';
import { createApp } from '../../src/app';
import { parseTrustProxy } from '../../src/utils/trustProxy';

describe('auth rate limiting', () => {
  const app = createApp({ disableRateLimit: false });

  it('throttles repeated login attempts with 429 RATE_LIMITED', async () => {
    let last: request.Response | undefined;
    for (let i = 0; i < 11; i++) {
      last = await request(app).post('/api/auth/login').send({});
    }
    expect(last!.status).toBe(429);
    expect(last!.body.error.code).toBe('RATE_LIMITED');
  });

  it('keeps a separate budget per endpoint (login exhaustion does not block refresh)', async () => {
    const res = await request(app).post('/api/auth/refresh-token').send({});
    expect(res.status).not.toBe(429);
  });
});

describe('limits on abuse-prone endpoints that used to share only the global budget', () => {
  // Each assertion uses its own app so budgets never bleed between cases
  const hammer = async (method: 'post' | 'get', path: string, attempts: number) => {
    const app = createApp({ disableRateLimit: false });
    let firstBlocked = 0;
    for (let i = 1; i <= attempts; i++) {
      const res = await request(app)[method](path).send({});
      if (res.status === 429 && !firstBlocked) firstBlocked = i;
    }
    return firstBlocked;
  };

  it('guest donation orders (creates gateway orders and PENDING rows) are limited to 20 per window', async () => {
    expect(await hammer('post', '/api/donations/order', 25)).toBe(21);
  });

  it('invite sending (outbound e-mail) is limited to 30 per window', async () => {
    expect(await hammer('post', '/api/invites/send', 35)).toBe(31);
  });

  it('2FA management is limited to 10 per window', async () => {
    expect(await hammer('post', '/api/auth/2fa/disable', 15)).toBe(11);
  });

  it.each([
    '/api/posts/video', '/api/posts/media', '/api/users/profile-photo', '/api/users/cover-photo',
    '/api/videos/upload', '/api/videos/upload-thumbnail', '/api/magazine/upload-file', '/api/magazine/upload-cover', '/api/marketplace/upload-image',
  ])(
    'uploads to %s are limited to 30 per window',
    async (path) => {
      expect(await hammer(path.includes('photo') ? 'post' : 'post', path, 35)).toBe(31);
    }
  );

  it('does not throttle webhooks', async () => {
    const app = createApp({ disableRateLimit: false });
    for (let i = 0; i < 25; i++) {
      const res = await request(app).post('/api/payments/webhook/razorpay').send({});
      expect(res.status).not.toBe(429);
    }
  });
});

describe('parseTrustProxy', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['1', 1],
    ['2', 2],
    ['0', false],
    ['false', false],
    ['off', false],
    ['loopback', 'loopback'],
    ['loopback, 10.0.0.0/8', ['loopback', '10.0.0.0/8']],
  ])('%j -> %j', (input, expected) => {
    expect(parseTrustProxy(input)).toEqual(expected);
  });

  it.each(['true', 'yes', '*', '-1', '1.5', 'drop table', '999'])('refuses to trust everything or garbage (%j) and falls back to one hop', (input) => {
    expect(parseTrustProxy(input)).toBe(1);
  });
});

describe('client IP for rate limiting follows TRUST_PROXY', () => {
  const original = process.env.TRUST_PROXY;
  afterEach(() => {
    if (original === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = original;
  });

  const loginsFromRotatingForwardedIps = async (count: number) => {
    const app = createApp({ disableRateLimit: false });
    let blockedAt = 0;
    for (let i = 1; i <= count; i++) {
      const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', `203.0.113.${i}`).send({});
      if (res.status === 429 && !blockedAt) blockedAt = i;
    }
    return blockedAt;
  };

  it('with no proxy in front (TRUST_PROXY=0) a spoofed X-Forwarded-For cannot dodge the limit', async () => {
    process.env.TRUST_PROXY = '0';
    expect(await loginsFromRotatingForwardedIps(15)).toBe(11);
  });

  it('behind one trusted proxy each forwarded client gets its own budget', async () => {
    process.env.TRUST_PROXY = '1';
    expect(await loginsFromRotatingForwardedIps(15)).toBe(0);
  });
});
