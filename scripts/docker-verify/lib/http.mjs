// Small HTTP client and polling helper. Nothing here throws on a network error: a failed request is { status: 0, error }.

export const createClient = (base, { fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) => {
  const root = String(base).replace(/\/+$/, '');
  const request = async (method, path, { body, token, headers = {}, timeout = timeoutMs } = {}) => {
    const sent = { Accept: 'application/json', ...headers };
    if (body !== undefined) sent['Content-Type'] = 'application/json';
    if (token) sent.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const started = Date.now();
    try {
      const response = await fetchImpl(`${root}${path}`, {
        method,
        headers: sent,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: 'manual',
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: response.status, headers: response.headers, json, text, ms: Date.now() - started };
    } catch (error) {
      return { status: 0, headers: new Headers(), json: null, text: '', error: String(error?.message ?? error), ms: Date.now() - started };
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    base: root,
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
  };
};

let sleepScale = 1;
/** For the tests only: 0.001 makes every wait a thousand times shorter (the fake world answers at once). */
export const setSleepScale = (scale) => {
  sleepScale = scale;
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms * sleepScale)));

/**
 * Calls `check` until it returns something truthy or the time is up. Resolves { ok, value, waitedMs }; never throws
 * (an exception inside `check` counts as "not yet").
 */
export const until = async (check, { timeoutMs = 60_000, intervalMs = 1_000 } = {}) => {
  const started = Date.now();
  let value;
  for (;;) {
    try {
      value = await check();
    } catch {
      value = undefined;
    }
    if (value) return { ok: true, value, waitedMs: Date.now() - started };
    if (Date.now() - started >= timeoutMs * sleepScale) return { ok: false, value, waitedMs: Date.now() - started };
    await sleep(intervalMs);
  }
};
