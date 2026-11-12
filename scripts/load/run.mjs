#!/usr/bin/env node
// A small, controlled load test of the read-heavy endpoints (directory, search, feed, events, jobs, news, notifications, network).
//
//   node scripts/load/run.mjs --api http://localhost:5051 --email E --password P [--duration 30] [--rps 20] [--concurrency 8]
//
// The API limits every address to 300 requests per 15 minutes (and refuses DISABLE_RATE_LIMIT in production), so a load test needs an
// API instance WITHOUT the limiter. Start a second local one for it (development mode only; it uses the same database, read-only requests):
//   cd server && PORT=5051 DISABLE_RATE_LIMIT=true node dist/index.js
// Rules: only GET requests; the rate is capped at 50 requests/second; a non-local address is refused unless --allow-remote (and then only
// against YOUR OWN test stack, never production). Exit code 1 when an endpoint is too slow or fails (see --max-p95 and --max-error-rate).
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { createLimiter, evaluate, summarize } from './stats.mjs';

const { values: o } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://localhost:5051' },
    email: { type: 'string' },
    password: { type: 'string' },
    duration: { type: 'string', default: '30' },
    rps: { type: 'string', default: '20' },
    concurrency: { type: 'string', default: '8' },
    'max-p95': { type: 'string', default: '500' },
    'max-error-rate': { type: 'string', default: '0.01' },
    'allow-remote': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});

const MAX_RPS = 50;
const api = o.api.replace(/\/+$/, '');
const rps = Math.min(Number(o.rps), MAX_RPS);
const duration = Number(o.duration);
const host = new URL(api).hostname;
const local = ['localhost', '127.0.0.1', '::1'].includes(host) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
if (!local && !o['allow-remote']) {
  console.error(`Refusing ${host}: not a local or private address. Use --allow-remote only for your own test stack.`);
  process.exit(2);
}
if (!o.email || !o.password) {
  console.error('--email and --password are needed (a test account).');
  process.exit(2);
}
if (Number(o.rps) > MAX_RPS) console.log(`(rate capped at ${MAX_RPS} requests/second)`);

const login = await fetch(`${api}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: o.email, password: o.password }) });
const token = (await login.json().catch(() => null))?.data?.accessToken;
if (!token) {
  console.error(`Login answered ${login.status}: cannot continue.`);
  process.exit(2);
}

const ENDPOINTS = [
  '/api/users/directory?limit=12',
  '/api/users/directory?limit=12&search=a',
  '/api/search?q=user',
  '/api/feed?tab=for-you',
  '/api/events?upcoming=true&limit=12',
  '/api/jobs?limit=12',
  '/api/news',
  '/api/notifications?limit=20',
  '/api/network/suggestions?limit=4',
  '/api/hashtags/trending?days=7&limit=8',
  '/api/landing',
];

const results = Object.fromEntries(ENDPOINTS.map((e) => [e, []]));
const next = createLimiter({ perSecond: rps });
const stopAt = Date.now() + duration * 1000;
let cursor = 0;

const worker = async () => {
  while (Date.now() < stopAt) {
    await next();
    const endpoint = ENDPOINTS[cursor++ % ENDPOINTS.length];
    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(`${api}${endpoint}`, { headers: { Authorization: `Bearer ${token}` } });
      await response.arrayBuffer();
      status = response.status;
    } catch {
      status = 0;
    }
    results[endpoint].push({ ms: Math.round(performance.now() - started), status });
  }
};

console.log(`Load test: ${duration} s at about ${rps} requests/second, ${o.concurrency} workers, against ${api}\n`);
await Promise.all(Array.from({ length: Number(o.concurrency) }, worker));

const summaries = Object.fromEntries(Object.entries(results).map(([endpoint, list]) => [endpoint, summarize(list)]));
console.log('endpoint'.padEnd(46), 'n'.padStart(5), 'p50'.padStart(6), 'p95'.padStart(6), 'p99'.padStart(6), 'max'.padStart(6), ' errors  statuses');
for (const [endpoint, s] of Object.entries(summaries)) {
  console.log(endpoint.padEnd(46), String(s.count).padStart(5), String(s.p50).padStart(6), String(s.p95).padStart(6), String(s.p99).padStart(6), String(s.max).padStart(6), String(s.errors).padStart(7), ' ', JSON.stringify(s.statuses));
}
const verdict = evaluate(summaries, { maxP95Ms: Number(o['max-p95']), maxErrorRate: Number(o['max-error-rate']) });
console.log(verdict.ok ? '\nPASS' : `\nFAIL\n${verdict.failures.map((f) => `  ${f.endpoint}: ${f.why}`).join('\n')}`);
if (o.out) fs.writeFileSync(o.out, JSON.stringify({ api, duration, rps, summaries, verdict }, null, 2));
process.exit(verdict.ok ? 0 : 1);
