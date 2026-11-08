import request from 'supertest';
import { createApp } from '../../app';

describe('CORS', () => {
  const original = process.env.CORS_ORIGINS;
  beforeAll(() => {
    process.env.CORS_ORIGINS = 'https://alumni.example.edu, http://localhost:3000';
  });
  afterAll(() => {
    process.env.CORS_ORIGINS = original;
  });

  const app = () => createApp({ disableRateLimit: true });

  it('echoes an allowed origin with credentials', async () => {
    const res = await request(app()).get('/health').set('Origin', 'https://alumni.example.edu');
    expect(res.headers['access-control-allow-origin']).toBe('https://alumni.example.edu');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows requests without an Origin header (server-to-server, curl, webhooks)', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).not.toBe(403);
  });

  it.each(['https://evil.example.com', 'null', 'https://alumni.example.edu.evil.com', 'http://alumni.example.edu'])(
    'refuses origin %j with a clean 403 (not a 500) and no CORS headers',
    async (origin) => {
      const res = await request(app()).get('/health').set('Origin', origin);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN_ORIGIN' } });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  );

  it('does not leak a stack trace or internals when refusing', async () => {
    const res = await request(app()).get('/api/users/stats').set('Origin', 'https://evil.example.com');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|at \w+ \(/i);
  });
});
