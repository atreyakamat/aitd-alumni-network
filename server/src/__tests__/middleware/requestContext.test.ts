import express from 'express';
import request from 'supertest';
import { requestContext } from '../../middleware/requestContext';
import { log } from '../../utils/logger';

jest.mock('../../utils/logger', () => ({ log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const makeApp = () => {
  const app = express();
  app.use(requestContext);
  app.get('/api/things/:token', (_req, res) => res.json({ ok: true }));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/boom', (_req, res) => res.status(500).json({ ok: false }));
  app.get('/slow', async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    res.json({ ok: true });
  });
  app.use('/uploads', (_req, res) => res.status(200).send('file'));
  return app;
};

const lastLog = (level: 'info' | 'warn' | 'error') => (log[level] as jest.Mock).mock.calls.at(-1);

beforeEach(() => jest.clearAllMocks());

describe('request id', () => {
  it('gives every response an X-Request-Id, a fresh UUID by default', async () => {
    const a = await request(makeApp()).get('/api/things/x');
    const b = await request(makeApp()).get('/api/things/x');
    expect(a.headers['x-request-id']).toMatch(UUID);
    expect(b.headers['x-request-id']).not.toBe(a.headers['x-request-id']);
  });

  it('keeps an id the caller (or the proxy in front) supplied, so one request can be followed across systems', async () => {
    const res = await request(makeApp()).get('/api/things/x').set('X-Request-Id', 'proxy-req-12345');
    expect(res.headers['x-request-id']).toBe('proxy-req-12345');
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'x'.repeat(65)],
    ['with spaces', 'has spaces in it here'],
    ['with a newline-ish character', 'abcdefgh%0d%0aSet-Cookie'],
    ['with markup', '<script>alert(1)</script>'],
  ])('replaces a caller id that is %s (it ends up in logs and headers)', async (_label, supplied) => {
    const res = await request(makeApp()).get('/api/things/x').set('X-Request-Id', supplied);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('access log', () => {
  it('writes one line per request: id, method, route, status, duration', async () => {
    const res = await request(makeApp()).get('/api/things/abc?search=private');
    const [message, fields] = lastLog('info')!;
    expect(message).toBe('request');
    expect(fields).toMatchObject({ id: res.headers['x-request-id'], method: 'GET', status: 200 });
    expect(typeof fields.ms).toBe('number');
  });

  it('never records the query string or a token in the path: it logs the route pattern', async () => {
    await request(makeApp()).get('/api/things/SECRET-INVITE-TOKEN?code=ONE-TIME-CODE');
    const [, fields] = lastLog('info')!;
    expect(JSON.stringify(fields)).not.toContain('SECRET-INVITE-TOKEN');
    expect(JSON.stringify(fields)).not.toContain('ONE-TIME-CODE');
    expect(fields.route).toBe('/api/things/:token');
  });

  it('logs a request that matched no route by its (shortened, query-free) path', async () => {
    await request(makeApp()).get(`/nowhere/${'a'.repeat(300)}?x=1`);
    const [, fields] = lastLog('info')!;
    expect(String(fields.route).length).toBeLessThanOrEqual(120);
    expect(String(fields.route)).not.toContain('?x=1');
  });

  it('logs server errors at error level', async () => {
    await request(makeApp()).get('/boom');
    expect(log.error).toHaveBeenCalledWith('request', expect.objectContaining({ status: 500 }));
  });

  it('flags slow requests as warnings', async () => {
    process.env.SLOW_REQUEST_MS = '10';
    await request(makeApp()).get('/slow');
    delete process.env.SLOW_REQUEST_MS;
    expect(log.warn).toHaveBeenCalledWith('request', expect.objectContaining({ slow: true }));
  });

  it('stays quiet about health probes and successful static files, which would drown everything else', async () => {
    await request(makeApp()).get('/health');
    await request(makeApp()).get('/uploads/photo.png');
    expect(log.info).not.toHaveBeenCalled();
  });
});
