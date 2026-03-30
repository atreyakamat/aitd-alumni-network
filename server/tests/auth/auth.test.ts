import request from 'supertest';
import app from '../../src/index';

describe('System Health & Setup', () => {
  it('should return 200 OK from the health check endpoint', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });

  it('should have rate limiting configured', async () => {
    // Make 101 requests to trigger rate limit (max is 100)
    let res;
    for (let i = 0; i < 101; i++) {
      res = await request(app).get('/api/users/stats');
    }
    expect(res!.status).toBe(429);
    expect(res!.body.error).toBe('Too many requests, please try again later.');
  });
});
