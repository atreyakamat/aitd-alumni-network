// The probe planner: decides WHICH identity may call WHICH documented endpoint, and what a correct answer looks like.
// It is pure (no network, no clock), so the safety rules are unit-tested in scripts/security/__tests__/probe-plan.test.mjs.
//
// Safety rules (the reason this module exists as its own file):
//   * Requests that could change data are only ever sent as
//       - a visitor (no token): the API must refuse them with 401 before any handler runs, or
//       - a member against an admin-level route: the API must refuse them with 403 before any handler runs, or
//       - a plain ADMIN against a super-admin route: 403 before any handler.
//     All of them carry the syntactically valid, nonexistent id 00000000-0000-4000-8000-000000000000 and an empty body.
//   * Admin identities otherwise only send GET requests.
//   * A member sends GET requests on member/public/optional routes; `unsafe` additionally sends mutating member-level
//     requests with an empty body (the owner opts in; still never the denylist).
//   * DENYLIST: these are never called with a real identity, with or without `unsafe`.

export const NONEXISTENT_UUID = '00000000-0000-4000-8000-000000000000';

/** Rank an identity needs to pass a route's guard. public/optional need no token at all (-1). */
export const REQUIRED_RANK = {
  public: -1,
  optional: -1,
  member: 0,
  'chapter-admin': 1,
  admin: 2,
  'super-admin': 3,
};

/** Rank of the role a signed-in identity holds. */
export const ROLE_RANK = { MEMBER: 0, CHAPTER_ADMIN: 1, ADMIN: 2, SUPER_ADMIN: 3 };

/**
 * Routes that must never be called with a real identity: they end a session, change credentials, delete or export
 * personal data, move money or truncate the audit log. (A visitor may be sent to them: the answer must be 401.)
 */
export function isDenylisted(method, template) {
  const p = String(template).replace(/\/+$/, '').toLowerCase();
  const m = String(method).toUpperCase();
  if (p === '/auth/logout') return true;
  if (p === '/auth/change-password') return true;
  if (p === '/auth/2fa' || p.startsWith('/auth/2fa/')) return true;
  if (m === 'DELETE' && p === '/users/me') return true;
  if (p === '/users/me/export') return true;
  if (p === '/payments' || p.startsWith('/payments/')) return true;
  if (p === '/donations' || p.startsWith('/donations/')) return true;
  if (p === '/admin/audit/cleanup') return true;
  return false;
}

/**
 * Admin-level mutating routes with a side effect that reaches people outside the system (mail to every member). A broken
 * guard would make the probe itself send that mail, so a member is only sent to them with `unsafe` (a visitor always is:
 * a visitor is stopped at authentication, before anything could run).
 */
export function isMassEffect(method, template) {
  const p = String(template).replace(/\/+$/, '').toLowerCase();
  return String(method).toUpperCase() === 'POST' && (p === '/admin/digest/send' || p === '/admin/digest/test');
}

/** "/users/:id/follow" -> "/users/00000000-0000-4000-8000-000000000000/follow" */
export function fillPath(template) {
  return template.replace(/:[A-Za-z0-9_]+/g, NONEXISTENT_UUID);
}

const isMutating = (method) => String(method).toUpperCase() !== 'GET' && String(method).toUpperCase() !== 'HEAD';

/**
 * Identities are `{ name, rank, breadth }`:
 *   visitor      { name: 'visitor', rank: -1 }
 *   member       { name: 'member', rank: 0 }
 *   admin        { name: 'admin', rank: 3 }          the account given with --admin-* (rank from its real role)
 *   plain-admin  { name: 'plain-admin', rank: 2, breadth: 'refusals' }   only the routes it must be refused on
 *
 * @param {Array<{method: string, path: string, access: string}>} endpoints
 * @param {{ identities: Array<{name: string, rank: number, breadth?: string}>, unsafe?: boolean }} options
 * @returns {{ items: Array<object>, skipped: Array<object> }}
 */
export function buildPlan(endpoints, { identities, unsafe = false }) {
  const items = [];
  const skipped = [];

  const add = (identity, endpoint, expectation, assertion, extra = {}) => {
    const method = endpoint.method.toUpperCase();
    items.push({
      id: `${identity.name} ${method} ${endpoint.path}`,
      identity: identity.name,
      method,
      template: endpoint.path,
      path: fillPath(endpoint.path),
      access: endpoint.access,
      expectation,
      assertion,
      // Mutating requests carry an empty JSON object: nothing to create, nothing to change
      body: isMutating(method) ? {} : undefined,
      ...extra,
    });
  };
  const skip = (identity, endpoint, reason) =>
    skipped.push({ identity: identity.name, method: endpoint.method.toUpperCase(), path: endpoint.path, reason });

  for (const identity of identities) {
    for (const endpoint of endpoints) {
      const method = endpoint.method.toUpperCase();
      const required = REQUIRED_RANK[endpoint.access];
      if (required === undefined) throw new Error(`Unknown access level "${endpoint.access}" for ${method} ${endpoint.path}`);
      const mutating = isMutating(method);

      // ---- a visitor ----------------------------------------------------------------------------------------------
      if (identity.name === 'visitor') {
        if (required >= 0) {
          add(identity, endpoint, 'unauthorized', 'A'); // 401 before any handler, whatever the method
        } else if (!mutating) {
          add(identity, endpoint, 'no-5xx', 'D'); // public/optional read: must at least never crash
        } else {
          skip(identity, endpoint, 'public mutating route: a visitor would reach its handler');
        }
        continue;
      }

      // ---- every real identity: the denylist ----------------------------------------------------------------------
      if (isDenylisted(method, endpoint.path)) {
        skip(identity, endpoint, 'denylist: never called with a real identity');
        continue;
      }

      // ---- a signed-in identity that is NOT high enough for this route: must be refused (403) ----------------------
      if (required > identity.rank) {
        if (identity.rank === 0 && isMassEffect(method, endpoint.path) && !unsafe) {
          skip(identity, endpoint, 'mass-mail side effect if the guard were broken (add --unsafe to include)');
        } else {
          add(identity, endpoint, 'forbidden', identity.rank === 0 ? 'B' : 'C');
        }
        continue;
      }

      // ---- allowed by rank: only reads (the refusals above are the only mutating calls an admin sends) --------------
      if (identity.breadth === 'refusals') {
        skip(identity, endpoint, 'plain-admin identity only probes the routes it must be refused on');
        continue;
      }
      if (mutating) {
        if (identity.rank === 0 && unsafe && required === 0) {
          add(identity, endpoint, 'authenticated', 'E'); // --unsafe: member-level write, empty body (never a public route: login, register, forgot-password...)
        } else {
          skip(identity, endpoint, identity.rank === 0 ? 'mutating member-level call (add --unsafe to include)' : 'admin identities send GET requests only');
        }
        continue;
      }
      // GET: a member-level (or public) route needs a valid session; an admin-level route must not refuse an admin
      add(identity, endpoint, required >= 1 ? 'allowed' : 'authenticated', 'E');
    }
  }
  return { items, skipped };
}

/**
 * Judge one answer. 429 is never judged (the caller waits and retries); a missing answer (status 0) is a failure.
 * @returns {{ ok: boolean, problem?: string }}
 */
export function evaluate(item, status) {
  if (status === 429) throw new Error('evaluate() must not be called with a 429: wait and retry instead');
  if (!Number.isInteger(status) || status === 0) return { ok: false, problem: 'no HTTP response (connection failed or timed out)' };
  if (status >= 500) {
    return { ok: false, problem: `server error ${status} for a syntactically valid, nonexistent id (must be a clean 4xx)` };
  }
  switch (item.expectation) {
    case 'unauthorized':
      return status === 401 ? { ok: true } : { ok: false, problem: `expected 401 for a visitor on a ${item.access} route, got ${status}` };
    case 'forbidden':
      return status === 403
        ? { ok: true }
        : { ok: false, problem: `expected 403 for ${item.identity} on a ${item.access} route, got ${status}${status === 401 ? ' (the token was not accepted)' : ''}` };
    case 'allowed':
      return status !== 401 && status !== 403
        ? { ok: true }
        : { ok: false, problem: `${item.identity} was refused (${status}) on a ${item.access} route it is entitled to` };
    case 'authenticated':
      return status !== 401 ? { ok: true } : { ok: false, problem: `${item.identity} got 401 although signed in` };
    case 'no-5xx':
      return { ok: true };
    default:
      throw new Error(`Unknown expectation "${item.expectation}"`);
  }
}

/** Skipped calls grouped by reason, for the report. */
export function summariseSkipped(skipped) {
  const byReason = {};
  for (const entry of skipped) byReason[entry.reason] = (byReason[entry.reason] ?? 0) + 1;
  return byReason;
}
