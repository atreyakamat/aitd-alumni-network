import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, summarize, createLimiter, evaluate } from '../stats.mjs';

test('percentile: nearest-rank on a sorted copy, safe for small and empty lists', () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([5], 99), 5);
  const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 95), 100);
  assert.equal(percentile([...values].reverse(), 50), 50, 'input order does not matter');
  assert.deepEqual(values, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 'the input is not modified');
});

test('summarize: counts per status class, latency percentiles and the error rate', () => {
  const s = summarize([
    { ms: 10, status: 200 }, { ms: 20, status: 200 }, { ms: 30, status: 404 }, { ms: 500, status: 500 }, { ms: 40, status: 0 },
  ]);
  assert.equal(s.count, 5);
  assert.deepEqual(s.statuses, { 200: 2, 404: 1, 500: 1, 0: 1 });
  assert.equal(s.errors, 2, '5xx and network failures are errors; a 404 is not');
  assert.equal(s.errorRate, 0.4);
  assert.equal(s.p50, 30);
  assert.equal(s.max, 500);
});

test('limiter: never releases more than the requested rate over a window', async () => {
  let now = 0;
  const waits = [];
  const limiter = createLimiter({ perSecond: 10, now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; } });
  for (let i = 0; i < 25; i++) await limiter();
  assert.ok(now >= 2300 && now <= 2600, `25 requests at 10/s take about 2.4 s of waiting, took ${now} ms`);
  assert.ok(waits.every((ms) => ms <= 100));
});

test('evaluate: fails on slow or failing endpoints and says which', () => {
  const ok = { count: 100, errorRate: 0, p95: 120 };
  const verdict = evaluate({ '/a': ok, '/b': { count: 100, errorRate: 0.02, p95: 90 }, '/c': { count: 100, errorRate: 0, p95: 900 } }, { maxP95Ms: 500, maxErrorRate: 0.01 });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.failures.map((f) => f.endpoint), ['/b', '/c']);
  assert.equal(evaluate({ '/a': ok }, { maxP95Ms: 500, maxErrorRate: 0.01 }).ok, true);
});
