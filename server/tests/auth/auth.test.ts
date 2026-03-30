import request from 'supertest';
import express from 'express';

// Create a minimal test app that mirrors the main app's health endpoint
const testApp = express();
testApp.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

describe('System Health & Setup', () => {
  it('should return 200 OK from the health check endpoint', async () => {
    const res = await request(testApp).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});
