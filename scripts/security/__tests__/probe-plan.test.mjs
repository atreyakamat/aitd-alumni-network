import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadApiReference } from '../lib/api-reference.mjs';
import { buildPlan, evaluate, fillPath, isDenylisted, isMassEffect, summariseSkipped, NONEXISTENT_UUID } from '../lib/probe-plan.mjs';

const { endpoints } = await loadApiReference();

const VISITOR = { name: 'visitor', rank: -1 };
const MEMBER = { name: 'member', rank: 0 };
const ADMIN = { name: 'admin', rank: 3 };
const PLAIN_ADMIN = { name: 'plain-admin', rank: 2, breadth: 'refusals' };
const ALL = [VISITOR, MEMBER, ADMIN, PLAIN_ADMIN];

const byIdentity = (plan, name) => plan.items.filter((item) => item.identity === name);
const isMutating = (item) => item.method !== 'GET';
const rank = { public: -1, optional: -1, member: 0, 'chapter-admin': 1, admin: 2, 'super-admin': 3 };

test('the placeholder id is a syntactically valid UUID that no row can have', () => {
  assert.equal(NONEXISTENT_UUID, '00000000-0000-4000-8000-000000000000');
  assert.match(NONEXISTENT_UUID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fillPath('/posts/:postId/comments'), `/posts/${NONEXISTENT_UUID}/comments`);
  assert.equal(fillPath('/admin/audit/:entityType/:entityId'), `/admin/audit/${NONEXISTENT_UUID}/${NONEXISTENT_UUID}`);
  assert.equal(fillPath('/auth/me'), '/auth/me');
});

test('visitor: 401 on every non-public route (any method), reads only on public/optional ones', () => {
  const plan = buildPlan(endpoints, { identities: [VISITOR] });
  for (const endpoint of endpoints) {
    const item = plan.items.find((i) => i.method === endpoint.method && i.template === endpoint.path);
    if (rank[endpoint.access] >= 0) {
      assert.equal(item?.expectation, 'unauthorized', `${endpoint.method} ${endpoint.path}`);
      assert.equal(item.assertion, 'A');
    } else if (endpoint.method === 'GET') {
      assert.equal(item?.expectation, 'no-5xx');
    } else {
      assert.equal(item, undefined, `public mutating ${endpoint.method} ${endpoint.path} must not be sent`);
    }
  }
});

test('member: refused (403) on every chapter-admin, admin and super-admin route, any method', () => {
  const plan = buildPlan(endpoints, { identities: [MEMBER], unsafe: true });
  for (const endpoint of endpoints.filter((e) => rank[e.access] >= 1)) {
    const item = plan.items.find((i) => i.method === endpoint.method && i.template === endpoint.path);
    if (isDenylisted(endpoint.method, endpoint.path)) {
      assert.equal(item, undefined, `${endpoint.method} ${endpoint.path} is denylisted`);
    } else {
      assert.equal(item?.expectation, 'forbidden', `${endpoint.method} ${endpoint.path}`);
      assert.equal(item.assertion, 'B');
    }
  }
});

test('member: only GET on member-level routes by default; --unsafe adds empty-body writes, never the denylist', () => {
  const safe = buildPlan(endpoints, { identities: [MEMBER] });
  for (const item of safe.items.filter((i) => rank[i.access] <= 0)) assert.equal(item.method, 'GET', item.id);

  const unsafe = buildPlan(endpoints, { identities: [MEMBER], unsafe: true });
  const writes = unsafe.items.filter((i) => rank[i.access] <= 0 && isMutating(i));
  assert.ok(writes.every((i) => i.access === 'member'), 'never a write to a public route (login, register, forgot-password...)');
  assert.ok(writes.length > 50, 'an unsafe run does send member-level writes');
  for (const item of writes) {
    assert.deepEqual(item.body, {}, `${item.id} must carry an empty body`);
    assert.equal(item.expectation, 'authenticated');
  }
  assert.ok(unsafe.items.length > safe.items.length);
});

test('the denylist is enforced for every real identity, with and without --unsafe', () => {
  for (const unsafe of [false, true]) {
    const plan = buildPlan(endpoints, { identities: ALL, unsafe });
    for (const item of plan.items.filter((i) => i.identity !== 'visitor')) {
      assert.equal(isDenylisted(item.method, item.template), false, `${item.id} is denylisted (unsafe=${unsafe})`);
      for (const forbidden of ['/auth/logout', '/auth/change-password', '/auth/2fa/', '/users/me/export', '/payments/', '/donations/', '/admin/audit/cleanup']) {
        assert.ok(!item.template.startsWith(forbidden) && item.template !== forbidden.replace(/\/$/, ''), `${item.id} touches ${forbidden}`);
      }
      assert.ok(!(item.method === 'DELETE' && item.template === '/users/me'), 'DELETE /users/me');
    }
    // and the skipped list says so
    const skipped = plan.skipped.filter((s) => s.reason.startsWith('denylist'));
    assert.ok(skipped.some((s) => s.path === '/auth/logout'));
    assert.ok(skipped.some((s) => s.path === '/admin/audit/cleanup'));
    assert.ok(skipped.some((s) => s.path === '/payments/webhook/razorpay'));
  }
});

test('isDenylisted covers the documented list and is not fooled by case or a trailing slash', () => {
  const denied = [
    ['POST', '/auth/logout'], ['POST', '/auth/change-password'], ['POST', '/auth/2fa/enable'], ['POST', '/auth/2fa/disable'],
    ['DELETE', '/users/me'], ['GET', '/users/me/export'], ['POST', '/payments/webhook/razorpay'], ['GET', '/donations/wall'],
    ['POST', '/donations/order'], ['POST', '/admin/audit/cleanup'], ['post', '/Auth/Logout/'],
  ];
  for (const [method, path] of denied) assert.equal(isDenylisted(method, path), true, `${method} ${path}`);
  const allowed = [['GET', '/users/me'], ['GET', '/auth/me'], ['GET', '/users/:id'], ['GET', '/admin/audit'], ['GET', '/transactions/my'], ['PATCH', '/users/profile']];
  for (const [method, path] of allowed) assert.equal(isDenylisted(method, path), false, `${method} ${path}`);
});

test('mass-mail routes are held back from a member unless --unsafe (a visitor is always stopped at authentication)', () => {
  assert.equal(isMassEffect('POST', '/admin/digest/send'), true);
  assert.equal(isMassEffect('GET', '/admin/digest'), false);
  const safe = buildPlan(endpoints, { identities: [VISITOR, MEMBER] });
  assert.ok(!safe.items.some((i) => i.identity === 'member' && i.template === '/admin/digest/send'));
  assert.ok(safe.skipped.some((s) => s.identity === 'member' && s.path === '/admin/digest/send' && /mass-mail/.test(s.reason)));
  assert.ok(safe.items.some((i) => i.identity === 'visitor' && i.template === '/admin/digest/send' && i.expectation === 'unauthorized'));
  const unsafe = buildPlan(endpoints, { identities: [MEMBER], unsafe: true });
  assert.ok(unsafe.items.some((i) => i.template === '/admin/digest/send'));
});

test('admin identity: GET only, never a mutating request', () => {
  const plan = buildPlan(endpoints, { identities: [ADMIN], unsafe: true });
  assert.ok(plan.items.length > 80);
  for (const item of plan.items) {
    assert.equal(item.method, 'GET', item.id);
    assert.equal(item.body, undefined);
    assert.ok(item.expectation === 'allowed' || item.expectation === 'authenticated');
    assert.equal(item.expectation === 'allowed', rank[item.access] >= 1, item.id);
  }
  assert.ok(plan.items.some((i) => i.template === '/admin/users'));
});

test('plain admin: only the super-admin routes, expected to be refused', () => {
  const plan = buildPlan(endpoints, { identities: [PLAIN_ADMIN] });
  const items = byIdentity(plan, 'plain-admin');
  assert.deepEqual(items.map((i) => `${i.method} ${i.template}`).sort(), ['DELETE /chapters/:id']); // POST /admin/audit/cleanup is denylisted
  assert.equal(items[0].expectation, 'forbidden');
  assert.equal(items[0].assertion, 'C');
  assert.equal(items[0].path, `/chapters/${NONEXISTENT_UUID}`);
});

test('every mutating request is one that must be refused before a handler: visitor, member on admin routes, plain admin on super-admin routes', () => {
  const plan = buildPlan(endpoints, { identities: ALL, unsafe: false });
  for (const item of plan.items.filter(isMutating)) {
    const ok =
      (item.identity === 'visitor' && item.expectation === 'unauthorized') ||
      (item.identity === 'member' && item.expectation === 'forbidden') ||
      (item.identity === 'plain-admin' && item.expectation === 'forbidden');
    assert.ok(ok, `${item.id} would reach a handler`);
    assert.ok(item.path.includes(NONEXISTENT_UUID) || !item.template.includes(':'), `${item.id} uses a real id`);
    assert.deepEqual(item.body, {});
  }
});

test('the skipped list is explained and summarised', () => {
  const plan = buildPlan(endpoints, { identities: ALL });
  assert.ok(plan.skipped.length > 100);
  for (const entry of plan.skipped) assert.ok(entry.reason && entry.identity && entry.path);
  const summary = summariseSkipped(plan.skipped);
  assert.ok(summary['admin identities send GET requests only'] > 0 || summary['mutating member-level call (add --unsafe to include)'] > 0);
});

test('an unknown access level is an error, not a silent allow', () => {
  assert.throws(() => buildPlan([{ method: 'GET', path: '/x', access: 'wizard' }], { identities: [VISITOR] }), /Unknown access level/);
});

test('evaluate: the verdict for every expectation', () => {
  const item = (expectation, identity = 'member', access = 'admin') => ({ expectation, identity, access });
  assert.equal(evaluate(item('unauthorized', 'visitor'), 401).ok, true);
  assert.equal(evaluate(item('unauthorized', 'visitor'), 200).ok, false);
  assert.equal(evaluate(item('unauthorized', 'visitor'), 403).ok, false);
  assert.equal(evaluate(item('forbidden'), 403).ok, true);
  assert.equal(evaluate(item('forbidden'), 400).ok, false, 'a 400 means validation ran before the role check');
  assert.equal(evaluate(item('forbidden'), 404).ok, false);
  assert.match(evaluate(item('forbidden'), 401).problem, /token was not accepted/);
  assert.equal(evaluate(item('allowed', 'admin'), 404).ok, true);
  assert.equal(evaluate(item('allowed', 'admin'), 403).ok, false);
  assert.equal(evaluate(item('authenticated', 'member', 'member'), 403).ok, true, 'a member may legitimately be refused a resource');
  assert.equal(evaluate(item('authenticated', 'member', 'member'), 401).ok, false);
  assert.equal(evaluate(item('no-5xx', 'visitor', 'public'), 401).ok, true);
});

test('evaluate: a 5xx is a failure whatever the expectation; no response is a failure; a 429 is never judged', () => {
  for (const expectation of ['unauthorized', 'forbidden', 'allowed', 'authenticated', 'no-5xx']) {
    for (const status of [500, 502, 503]) {
      const verdict = evaluate({ expectation, identity: 'x', access: 'member' }, status);
      assert.equal(verdict.ok, false, `${expectation} ${status}`);
      assert.match(verdict.problem, /server error/);
    }
  }
  assert.equal(evaluate({ expectation: 'no-5xx', identity: 'x', access: 'public' }, 0).ok, false);
  assert.throws(() => evaluate({ expectation: 'no-5xx', identity: 'x', access: 'public' }, 429), /429/);
});
