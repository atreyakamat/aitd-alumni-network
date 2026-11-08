import request from 'supertest';
import { createApp } from '../../src/app';
import { prismaMock } from '../helpers';

const app = createApp({ disableRateLimit: true });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request ids reach every kind of response', () => {
  it('a normal response', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('an unknown route (404)', async () => {
    const res = await request(app).get('/api/no-such-thing');
    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('a rejected request body (400)', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{not json');
    expect(res.status).toBe(400);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('echoes the id a proxy supplied', async () => {
    const res = await request(app).get('/health').set('X-Request-Id', 'from-the-proxy-0001');
    expect(res.headers['x-request-id']).toBe('from-the-proxy-0001');
  });
});

describe('/health', () => {
  it('reports the database and, informationally, Redis (disabled when not configured)', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', databaseStatus: 'up', redisStatus: 'disabled' });
  });

  it('answers 503 and names the database when it cannot be reached', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'degraded', databaseStatus: 'down' });
    expect(JSON.stringify(res.body)).not.toContain('connection refused');
  });
});
