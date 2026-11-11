// A polite HTTP client for probing a rate-limited API.
//
// The API shares a global budget (300 requests / 15 minutes / IP) and stricter budgets on auth routes; a probe that
// ignores them would measure the limiter instead of the authorization layer. This client
//   * spaces requests (default 4 per second, far below the 20 requests/second ceiling of the audit plan),
//   * reads the limiter headers of every answer (RateLimit-*, X-RateLimit-*, Retry-After) and sleeps until the window
//     resets when the remaining budget is nearly gone,
//   * keeps its own count of what it sent in the last window (other users of the same address are seen through the
//     headers),
//   * never hands a 429 to the caller: it waits (Retry-After, else the reset header, else exponential back-off) and
//     retries, within one overall deadline. When the deadline would be exceeded it throws DeadlineError and the caller
//     records the call as "not run" instead of guessing.
//
// Zero dependencies, Node 20+ (built-in fetch).

export class DeadlineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeadlineError';
  }
}

const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Read the rate-limit state out of response headers. Understands both families express-rate-limit can send:
 *   legacy   X-RateLimit-Limit / -Remaining / -Reset (epoch seconds)
 *   standard RateLimit-Limit / -Remaining / -Reset (seconds from now) and Retry-After (seconds or an HTTP date)
 * @param {Headers | Record<string,string>} headers
 * @param {number} nowMs
 */
export function readRateLimit(headers, nowMs = Date.now()) {
  const get = (name) => {
    if (typeof headers.get === 'function') return headers.get(name);
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
  };
  const num = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(String(value).split(',')[0].trim());
    return Number.isFinite(n) ? n : null;
  };

  const limit = num(get('ratelimit-limit')) ?? num(get('x-ratelimit-limit'));
  const remaining = num(get('ratelimit-remaining')) ?? num(get('x-ratelimit-remaining'));

  let resetAtMs = null;
  const reset = num(get('ratelimit-reset')) ?? num(get('x-ratelimit-reset'));
  if (reset !== null) resetAtMs = reset > 1e9 ? reset * 1000 : nowMs + reset * 1000; // epoch seconds or delta seconds

  let retryAfterMs = null;
  const retryAfter = get('retry-after');
  if (retryAfter) {
    const seconds = num(retryAfter);
    if (seconds !== null) retryAfterMs = seconds * 1000;
    else {
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) retryAfterMs = Math.max(0, date - nowMs);
    }
  }
  return { limit, remaining, resetAtMs, retryAfterMs };
}

/**
 * @param {object} options
 * @param {string} options.base            e.g. http://localhost:5050/api (no trailing slash)
 * @param {number} [options.minIntervalMs] gap between two requests (default 250)
 * @param {number} [options.budget]        requests per window the server allows (default 300)
 * @param {number} [options.windowMs]      window length (default 15 minutes)
 * @param {number} [options.safety]        stop this many requests short of the budget (default 6)
 * @param {number} [options.deadlineAt]    epoch ms after which waiting is refused (default: 30 minutes from now)
 * @param {number} [options.timeoutMs]     per-request timeout (default 30 s)
 * @param {(msg: string) => void} [options.log]
 * @param {(ms: number) => Promise<void>} [options.sleep]  injectable for tests
 * @param {() => number} [options.now]                     injectable for tests
 */
export function createClient(options) {
  const {
    base,
    minIntervalMs = 250,
    budget = 300,
    windowMs = 15 * 60 * 1000,
    safety = 6,
    timeoutMs = 30_000,
    log = () => {},
    sleep = sleepReal,
    now = Date.now,
  } = options;
  const deadlineAt = options.deadlineAt ?? now() + 30 * 60 * 1000;

  const sent = []; // timestamps of requests this client sent (sliding window)
  let lastSentAt = 0;
  let serverView = { remaining: null, resetAtMs: null, limit: null }; // from the most recent response carrying headers
  const stats = { requests: 0, rateLimited: 0, waitedMs: 0, waits: 0 };

  const waitUntil = async (untilMs, why) => {
    const wait = Math.ceil(untilMs - now());
    if (wait <= 0) return;
    if (now() + wait > deadlineAt) {
      throw new DeadlineError(`time limit reached while waiting ${Math.round(wait / 1000)} s for the rate limit (${why})`);
    }
    stats.waits += 1;
    stats.waitedMs += wait;
    log(`rate limit: waiting ${Math.round(wait / 1000)} s (${why})`);
    // Sleep in slices so a long wait stays visibly alive in CI logs
    let left = wait;
    while (left > 0) {
      const slice = Math.min(left, 30_000);
      await sleep(slice);
      left -= slice;
      if (left > 0) log(`rate limit: ${Math.round(left / 1000)} s left`);
    }
  };

  /** Block until sending one more request is safe. */
  const beforeSend = async () => {
    // 1) the server's own view: nearly out of budget -> wait for the reset it announced
    // (a small per-route budget such as 10 sign-in attempts must not keep us waiting at "6 left": 5% of the limit, at least 1)
    const threshold = serverView.limit ? Math.min(safety, Math.max(1, Math.floor(serverView.limit * 0.05))) : safety;
    if (serverView.remaining !== null && serverView.remaining <= threshold && serverView.resetAtMs && serverView.resetAtMs > now()) {
      const sharedBudget = serverView.limit === budget;
      await waitUntil(serverView.resetAtMs + 1000, `server reports ${serverView.remaining} requests left`);
      serverView = { remaining: null, resetAtMs: null, limit: null };
      // The server's window restarted at that reset, so what we sent before it no longer counts against the shared budget
      if (sharedBudget) sent.length = 0;
    }
    // 2) our own count over a sliding window
    while (sent.length && sent[0] <= now() - windowMs) sent.shift();
    if (sent.length >= budget - safety) {
      await waitUntil(sent[0] + windowMs + 1000, `${sent.length} requests sent in the last window`);
      while (sent.length && sent[0] <= now() - windowMs) sent.shift();
    }
    // 3) spacing
    const gap = lastSentAt + minIntervalMs - now();
    if (gap > 0) await sleep(gap);
  };

  const once = async (method, url, headers, body) => {
    await beforeSend();
    lastSentAt = now();
    sent.push(lastSentAt);
    stats.requests += 1;
    const started = now();
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      const limits = readRateLimit(response.headers, now());
      if (limits.remaining !== null) serverView = { remaining: limits.remaining, resetAtMs: limits.resetAtMs, limit: limits.limit };
      return { status: response.status, headers: response.headers, text, limits, ms: now() - started };
    } catch (error) {
      return { status: 0, headers: new Headers(), text: '', limits: readRateLimit({}), ms: now() - started, error: String(error?.cause?.code ?? error?.message ?? error) };
    }
  };

  /**
   * Send one request and return the final answer (never a 429 unless it persists past 8 attempts, which throws).
   * @param {{ method?: string, path: string, token?: string, body?: unknown, headers?: Record<string,string> }} request
   */
  async function request({ method = 'GET', path, token, body, headers = {} }) {
    const url = `${base}${path}`;
    const sendHeaders = { Accept: 'application/json', ...headers };
    if (token) sendHeaders.Authorization = `Bearer ${token}`;
    let payload;
    if (body !== undefined) {
      sendHeaders['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let transientRetries = 0;
    for (let attempt = 1; attempt <= 8; attempt++) {
      const answer = await once(method, url, sendHeaders, payload);
      if (answer.status === 429) {
        stats.rateLimited += 1;
        const fromServer = answer.limits.retryAfterMs ?? (answer.limits.resetAtMs ? answer.limits.resetAtMs - now() : null);
        const backoff = Math.min(60_000, 5_000 * 2 ** (attempt - 1));
        const waitMs = Math.max(1000, fromServer ?? backoff) + 500;
        await waitUntil(now() + waitMs, `429 on ${method} ${path}`);
        serverView = { remaining: null, resetAtMs: null, limit: null };
        if (answer.limits.limit === budget) sent.length = 0; // the window that refused us has restarted
        continue;
      }
      if (answer.status === 0 && transientRetries < 1) {
        transientRetries += 1; // one retry for a dropped connection; a second failure is a finding
        await sleep(1500);
        continue;
      }
      return answer;
    }
    throw new DeadlineError(`${method} ${path} was still rate limited after 8 attempts`);
  }

  return { request, stats, deadlineAt };
}
