import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createClient, readRateLimit, DeadlineError } from '../lib/http-client.mjs';

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}/api` }));
  });
const close = (server) => new Promise((resolve) => server.close(resolve));

test('readRateLimit understands the legacy X-RateLimit-* family (epoch reset)', () => {
  const now = 1_800_000_000_000;
  const headers = new Headers({ 'X-RateLimit-Limit': '300', 'X-RateLimit-Remaining': '236', 'X-RateLimit-Reset': String(now / 1000 + 120) });
  const state = readRateLimit(headers, now);
  assert.equal(state.limit, 300);
  assert.equal(state.remaining, 236);
  assert.equal(state.resetAtMs, now + 120_000);
  assert.equal(state.retryAfterMs, null);
});

test('readRateLimit understands RateLimit-* (reset in seconds) and Retry-After in seconds or as a date', () => {
  const now = Date.parse('2026-11-11T10:00:00Z');
  const standard = readRateLimit(new Headers({ 'RateLimit-Limit': '10', 'RateLimit-Remaining': '0', 'RateLimit-Reset': '45', 'Retry-After': '45' }), now);
  assert.equal(standard.remaining, 0);
  assert.equal(standard.resetAtMs, now + 45_000);
  assert.equal(standard.retryAfterMs, 45_000);
  const dated = readRateLimit(new Headers({ 'Retry-After': 'Wed, 11 Nov 2026 10:00:30 GMT' }), now);
  assert.equal(dated.retryAfterMs, 30_000);
  assert.deepEqual(readRateLimit(new Headers(), now), { limit: null, remaining: null, resetAtMs: null, retryAfterMs: null });
  assert.equal(readRateLimit({ 'x-ratelimit-remaining': '7' }, now).remaining, 7, 'plain objects work too');
});

test('a 429 is waited out and retried, never returned', async () => {
  let calls = 0;
  const { server, base } = await listen((req, res) => {
    calls += 1;
    if (calls === 1) {
      res.writeHead(429, { 'Retry-After': '7', 'Content-Type': 'application/json' });
      return res.end('{"success":false}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    const waits = [];
    const client = createClient({ base, minIntervalMs: 0, sleep: async (ms) => waits.push(ms) });
    const answer = await client.request({ path: '/x' });
    assert.equal(answer.status, 200);
    assert.ok(calls >= 2, `retried (${calls} attempts)`);
    assert.equal(client.stats.rateLimited, 1);
    assert.ok(waits.some((ms) => ms >= 7000), `waited at least Retry-After (${waits})`);
  } finally {
    await close(server);
  }
});

test('when the server reports the budget nearly spent the client sleeps until the window resets', async () => {
  let calls = 0;
  const { server, base } = await listen((req, res) => {
    calls += 1;
    res.writeHead(200, { 'X-RateLimit-Limit': '300', 'X-RateLimit-Remaining': calls === 1 ? '2' : '299', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 90) });
    res.end('{}');
  });
  try {
    const waits = [];
    const client = createClient({ base, minIntervalMs: 0, safety: 6, sleep: async (ms) => waits.push(ms) });
    await client.request({ path: '/a' });
    assert.deepEqual(waits, [], 'no wait while there is budget');
    await client.request({ path: '/b' });
    assert.ok(waits.reduce((a, b) => a + b, 0) >= 85_000, `slept until reset: ${waits}`);
    assert.equal(client.stats.waits, 1);
  } finally {
    await close(server);
  }
});

test('it counts its own requests: at the budget it waits for the window even without headers', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(200);
    res.end('{}');
  });
  try {
    const waits = [];
    const client = createClient({ base, minIntervalMs: 0, budget: 5, safety: 1, windowMs: 60_000, sleep: async (ms) => waits.push(ms) });
    for (let i = 0; i < 4; i++) await client.request({ path: '/n' });
    assert.deepEqual(waits, []);
    await client.request({ path: '/n' }); // 4 sent = budget - safety: wait for the oldest to leave the window
    assert.ok(waits.reduce((a, b) => a + b, 0) > 50_000, `waited ${waits}`);
  } finally {
    await close(server);
  }
});

test('after waiting out the announced window reset the client does not wait again for its sliding count', async () => {
  let calls = 0;
  const { server, base } = await listen((req, res) => {
    calls += 1;
    // limit equals the client's budget (a global limiter); the second answer says only 1 request is left
    res.writeHead(200, { 'X-RateLimit-Limit': '5', 'X-RateLimit-Remaining': calls === 2 ? '1' : '4', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60) });
    res.end('{}');
  });
  try {
    const waits = [];
    const client = createClient({ base, minIntervalMs: 0, budget: 5, safety: 1, windowMs: 900_000, sleep: async (ms) => waits.push(ms) });
    for (let i = 0; i < 6; i++) await client.request({ path: '/n' });
    // exactly one wait: for the server-announced reset after request 2; the 4 requests sent before it were forgotten
    assert.equal(client.stats.waits, 1, `waits: ${waits}`);
    assert.ok(waits.reduce((a, b) => a + b, 0) >= 55_000);
  } finally {
    await close(server);
  }
});

test('a wait that would pass the deadline throws DeadlineError instead of guessing', async () => {
  const { server, base } = await listen((req, res) => {
    res.writeHead(429, { 'Retry-After': '600' });
    res.end('');
  });
  try {
    const client = createClient({ base, minIntervalMs: 0, deadlineAt: Date.now() + 5_000, sleep: async () => {} });
    await assert.rejects(client.request({ path: '/x' }), DeadlineError);
  } finally {
    await close(server);
  }
});

test('a dropped connection is retried once, then reported as status 0', async () => {
  let calls = 0;
  const { server, base } = await listen((req) => {
    calls += 1;
    req.socket.destroy();
  });
  try {
    const client = createClient({ base, minIntervalMs: 0, sleep: async () => {}, timeoutMs: 2000 });
    const answer = await client.request({ path: '/x' });
    assert.equal(answer.status, 0);
    assert.ok(calls >= 2, `retried (${calls} attempts)`);
  } finally {
    await close(server);
  }
});

test('requests carry the bearer token and JSON bodies', async () => {
  let seen;
  const { server, base } = await listen((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { auth: req.headers.authorization, type: req.headers['content-type'], body, method: req.method, url: req.url };
      res.writeHead(200);
      res.end('{}');
    });
  });
  try {
    const client = createClient({ base, minIntervalMs: 0 });
    await client.request({ method: 'POST', path: '/things', token: 'abc', body: { a: 1 } });
    assert.deepEqual(seen, { auth: 'Bearer abc', type: 'application/json', body: '{"a":1}', method: 'POST', url: '/api/things' });
  } finally {
    await close(server);
  }
});
