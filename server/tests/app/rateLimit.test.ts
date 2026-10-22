import request from 'supertest';
import { createApp } from '../../src/app';

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
