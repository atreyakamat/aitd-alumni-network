/**
 * ROUND 2, found while re-verifying R2-14 - the request-target spelling the slash collapse did not cover.
 *
 * HTTP/1.1 lets a client send an ABSOLUTE-form request target ("POST http://host/api//auth/login HTTP/1.1"). Node hands
 * that to Express untouched, so `req.url` does not start with "/" and the repeated-slash collapse skipped it: the
 * per-endpoint limiter mounted on '/api/auth/login' did not match "/api//auth/login", while `app.use('/api', router)`
 * did, and the login handler ran outside its 10-per-window budget.
 *
 * supertest cannot send an absolute-form request line, so these tests talk to a real listener over a raw socket.
 */
import http from 'http';
import net from 'net';
import { AddressInfo } from 'net';
import { createApp } from '../../../src/app';

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer(createApp({ disableRateLimit: false }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Sends one request with the given request-target, verbatim, and returns the status code. */
const rawPost = (target: string, body = '{}'): Promise<number> =>
  new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let received = '';
    socket.on('connect', () =>
      socket.write(
        `POST ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
      )
    );
    socket.on('data', (chunk) => (received += chunk));
    socket.on('close', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(received)?.[1] ?? 0)));
    socket.on('error', reject);
    socket.setTimeout(5000, () => socket.destroy(new Error('timeout')));
  });

describe('R2-27 the per-endpoint budgets also hold for absolute-form request targets', () => {
  it('/api/auth/login: every spelling, including "http://host/api//auth/login", shares the 10-per-window budget', async () => {
    for (let i = 0; i < 10; i++) await rawPost('/api/auth/login');

    const origin = `http://127.0.0.1:${port}`;
    const spellings = [
      '/api/auth/login',
      '/api//auth/login',
      `${origin}/api/auth/login`,
      `${origin}/api//auth/login`,
      `${origin}/api///auth//login/`,
      `${origin}//api/auth/login`,
      `${origin}/api//auth/login?x=1`,
      `http://user:pass@127.0.0.1:${port}/api//auth/login`,
      `HTTP://127.0.0.1:${port}/api//auth/login`,
    ];
    for (const target of spellings) {
      const status = await rawPost(target);
      expect({ target, status }).toEqual({ target, status: 429 });
    }
  });

  it('an absolute-form target still routes normally (a legitimate proxy-style request is not broken)', async () => {
    const status = await rawPost(`http://127.0.0.1:${port}/api/does-not-exist`);
    expect(status).toBe(404);
  });
});
