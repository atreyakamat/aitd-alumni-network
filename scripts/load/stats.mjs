// Numbers for the load test: percentiles, a summary per endpoint, a request-rate limiter and the pass/fail verdict.

/** Nearest-rank percentile of a list (a sorted copy is used; the input is not changed). null for an empty list. */
export const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

/** Results of one endpoint: [{ ms, status }] (status 0 = no answer). A 5xx and a missing answer are errors; a 4xx is not. */
export const summarize = (results) => {
  const statuses = {};
  let errors = 0;
  for (const { status } of results) {
    statuses[status] = (statuses[status] ?? 0) + 1;
    if (status === 0 || status >= 500) errors++;
  }
  const times = results.map((r) => r.ms);
  return {
    count: results.length,
    statuses,
    errors,
    errorRate: results.length ? errors / results.length : 0,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: times.length ? Math.max(...times) : null,
  };
};

/** Resolves when the next request may be sent, spacing requests 1/perSecond apart. `now` and `sleep` are injectable for tests. */
export const createLimiter = ({ perSecond, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) => {
  const interval = 1000 / perSecond;
  let nextAt = 0;
  return async () => {
    const wait = nextAt - now();
    if (wait > 0) await sleep(wait);
    nextAt = Math.max(nextAt, now()) + interval;
  };
};

export const evaluate = (summaries, { maxP95Ms, maxErrorRate }) => {
  const failures = [];
  for (const [endpoint, s] of Object.entries(summaries)) {
    if (s.errorRate > maxErrorRate) failures.push({ endpoint, why: `error rate ${(s.errorRate * 100).toFixed(1)}% is above ${(maxErrorRate * 100).toFixed(1)}%` });
    else if (s.p95 !== null && s.p95 > maxP95Ms) failures.push({ endpoint, why: `p95 ${s.p95} ms is above ${maxP95Ms} ms` });
  }
  return { ok: failures.length === 0, failures };
};
