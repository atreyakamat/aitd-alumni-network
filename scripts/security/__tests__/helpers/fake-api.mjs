// A tiny fake of the platform API for the end-to-end tests of rbac-live.mjs.
// It enforces the DOCUMENTED access level of every endpoint of docs/API_REFERENCE.md (401 without a token, 403 below the
// required role, 404 for the nonexistent id) and can be told to misbehave in exactly the ways the probe must catch.
// Helper only: it has no tests of its own.

import http from 'node:http';

const RANK = { public: -1, optional: -1, member: 0, 'chapter-admin': 1, admin: 2, 'super-admin': 3 };
const ROLE_RANK = { MEMBER: 0, CHAPTER_ADMIN: 1, ADMIN: 2, SUPER_ADMIN: 3 };
export const ACCOUNTS = {
  'admin@fake.test': { role: 'SUPER_ADMIN', password: 'pw' },
  'member@fake.test': { role: 'MEMBER', password: 'pw' },
  'plain@fake.test': { role: 'ADMIN', password: 'pw' },
};

const compile = (template) => new RegExp(`^${template.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);

/**
 * @param {Array<{method: string, path: string, access: string}>} endpoints
 * @param {object} [options]
 * @param {string[]} [options.broken500]       "METHOD /template": answers 500 once the caller is authorised
 * @param {string[]} [options.leaky]           "METHOD /template": answers a visitor with 200 instead of 401
 * @param {boolean}  [options.plainAdminLeak]  a plain ADMIN is NOT refused on DELETE /chapters/:id
 * @param {string}   [options.rateLimitOnce]   "METHOD /template": the first call is answered 429 with Retry-After: 1
 * @param {number}   [options.expireMemberAfter] after this many API requests the member's access token stops working (401 once)
 */
export async function startFakeApi(endpoints, options = {}) {
  const routes = endpoints
    .map((e) => ({ ...e, key: `${e.method} ${e.path}`, regex: compile(e.path), params: (e.path.match(/:/g) || []).length }))
    .sort((a, b) => a.params - b.params); // literal routes win over parameter routes (/users/directory before /users/:id)

  const state = { tokens: new Map(), refresh: new Map(), counter: 0, apiRequests: 0, expired: false, rateLimited: false };
  const wire = [];
  const stats = { logins: 0, refreshes: 0 };

  const issue = (role) => {
    state.counter += 1;
    const access = `tok-${role}-${state.counter}`;
    const refresh = `ref-${role}-${state.counter}`;
    state.tokens.set(access, { role, valid: true });
    state.refresh.set(refresh, { role, valid: true });
    return { accessToken: access, refreshToken: refresh };
  };
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '100000', 'X-RateLimit-Remaining': '99999', 'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 900), ...headers });
    res.end(JSON.stringify(body));
  };
  const error = (res, status, code, message) => send(res, status, { success: false, error: { code, message } });

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://fake');
      if (url.pathname === '/health') return send(res, 200, { status: 'ok' });
      if (!url.pathname.startsWith('/api/')) return error(res, 404, 'NOT_FOUND', 'Not found');
      const apiPath = url.pathname.slice('/api'.length);
      state.apiRequests += 1;

      let body = {};
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        /* keep undefined */
      }
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const holder = bearer ? state.tokens.get(bearer) : undefined;
      wire.push({ method: req.method, path: apiPath, role: holder?.valid ? holder.role : bearer ? 'INVALID' : null, body });

      if (apiPath === '/auth/login' && req.method === 'POST') {
        const account = ACCOUNTS[body?.email];
        stats.logins += 1;
        if (!account || account.password !== body?.password) return error(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials');
        return send(res, 200, { success: true, data: { ...issue(account.role), user: { userRole: account.role } } });
      }
      if (apiPath === '/auth/refresh-token' && req.method === 'POST') {
        const row = state.refresh.get(body?.refreshToken);
        stats.refreshes += 1;
        if (!row || !row.valid) return error(res, 401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
        row.valid = false; // rotating: a reused refresh token is refused
        return send(res, 200, { success: true, data: issue(row.role) });
      }

      const route = routes.find((r) => r.method === req.method && r.regex.test(apiPath));
      if (!route) return error(res, 404, 'NOT_FOUND', 'Route not found');

      if (options.rateLimitOnce === route.key && !state.rateLimited) {
        state.rateLimited = true;
        return send(res, 429, { success: false, error: { code: 'RATE_LIMITED' } }, { 'Retry-After': '1' });
      }
      if (options.expireMemberAfter && !state.expired && holder?.role === 'MEMBER' && state.apiRequests > options.expireMemberAfter) {
        state.expired = true;
        for (const token of state.tokens.values()) if (token.role === 'MEMBER') token.valid = false;
      }
      const live = holder?.valid ? holder : undefined;
      if (bearer && !live) return error(res, 401, 'TOKEN_EXPIRED', 'Token expired');

      const required = RANK[route.access];
      if (required >= 0 && !live && !options.leaky?.includes(route.key)) return error(res, 401, 'NO_TOKEN', 'No token provided');
      if (live) {
        const rank = ROLE_RANK[live.role];
        const leak = options.plainAdminLeak && live.role === 'ADMIN' && route.key === 'DELETE /chapters/:id';
        if (rank < required && !leak) return error(res, 403, 'FORBIDDEN', 'Insufficient permissions');
      }
      if (options.broken500?.includes(route.key)) return error(res, 500, 'INTERNAL_ERROR', 'Something broke');
      return route.params ? error(res, 404, 'NOT_FOUND', 'No such record') : send(res, 200, { success: true, data: [] });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    api: `${origin}/api`,
    wire,
    stats,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
