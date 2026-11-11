import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACCESS_LEVELS, normaliseAccess, parseApiReference, loadApiReference, countByLevel } from '../lib/api-reference.mjs';

test('the real docs/API_REFERENCE.md parses completely', async () => {
  const reference = await loadApiReference();
  assert.equal(reference.basePath, '/api');
  assert.ok(reference.statedTotal > 100, 'the document states its endpoint total');

  // every documented endpoint was found ...
  assert.equal(reference.endpoints.length, reference.statedTotal);

  // ... the per-level counts the document states add up to the total, and match what the parser counted
  const statedSum = Object.values(reference.statedLevels).reduce((a, b) => a + b, 0);
  assert.equal(statedSum, reference.statedTotal, 'per-level counts in the document add up to its total');
  assert.deepEqual(Object.keys(reference.statedLevels).sort(), [...ACCESS_LEVELS].sort(), 'the document states every level');
  assert.deepEqual(countByLevel(reference.endpoints), reference.statedLevels);
});

test('no endpoint is listed twice and every row is well formed', async () => {
  const { endpoints } = await loadApiReference();
  const seen = new Set();
  for (const endpoint of endpoints) {
    const key = `${endpoint.method} ${endpoint.path}`;
    assert.ok(!seen.has(key), `duplicate ${key}`);
    seen.add(key);
    assert.match(endpoint.method, /^(GET|POST|PUT|PATCH|DELETE)$/);
    assert.match(endpoint.path, /^\/[A-Za-z0-9_\-/:.]*$/, `odd path ${endpoint.path}`);
    assert.ok(ACCESS_LEVELS.includes(endpoint.access), `unknown level for ${key}`);
    assert.ok(endpoint.section, `${key} has a section`);
  }
});

test('known endpoints are classified as documented', async () => {
  const { endpoints } = await loadApiReference();
  const find = (method, path) => endpoints.find((e) => e.method === method && e.path === path)?.access;
  assert.equal(find('POST', '/auth/login'), 'public');
  assert.equal(find('GET', '/users/stats'), 'public');
  assert.equal(find('GET', '/landing'), 'optional');
  assert.equal(find('POST', '/donations/order'), 'optional');
  assert.equal(find('GET', '/auth/me'), 'member');
  assert.equal(find('POST', '/events'), 'chapter-admin');
  assert.equal(find('GET', '/admin/users'), 'admin');
  assert.equal(find('POST', '/admin/audit/cleanup'), 'super-admin');
  assert.equal(find('DELETE', '/chapters/:id'), 'super-admin');
});

test('normaliseAccess maps every word the document uses and rejects unknown ones', () => {
  assert.equal(normaliseAccess('Public'), 'public');
  assert.equal(normaliseAccess('Public (personalised when signed in)'), 'optional');
  assert.equal(normaliseAccess('Signed in'), 'member');
  assert.equal(normaliseAccess('Chapter admin+'), 'chapter-admin');
  assert.equal(normaliseAccess('Admin+'), 'admin');
  assert.equal(normaliseAccess('Super admin'), 'super-admin');
  assert.equal(normaliseAccess('  signed   in '), 'member');
  assert.throws(() => normaliseAccess('Moderator'), /Unknown access level/);
});

test('parseApiReference reads a small synthetic document', () => {
  const doc = [
    '# API', 'Base path: `/api` (for example). 3 endpoints.', '',
    '| Level | Meaning | Endpoints |', '|---|---|---|', '| Public | No token needed | 1 |', '| Signed in | Any user | 1 |', '| Admin+ | Admins | 1 |', '',
    '## Things', '', '| Method | Path | Access | Validated |', '|---|---|---|---|',
    '| GET | `/things` | Public |  |', '| POST | `/things/:id` | Signed in | Yes |', '| DELETE | `/things/:id` | Admin+ |  |',
  ].join('\n');
  const parsed = parseApiReference(doc);
  assert.equal(parsed.statedTotal, 3);
  assert.deepEqual(parsed.statedLevels, { public: 1, member: 1, admin: 1 });
  assert.deepEqual(parsed.endpoints.map((e) => `${e.method} ${e.path} ${e.access} ${e.validated}`), [
    'GET /things public false', 'POST /things/:id member true', 'DELETE /things/:id admin false',
  ]);
});

test('a row with an unknown access word or without a backticked path is an error, not a silent skip', () => {
  assert.throws(() => parseApiReference('| GET | `/x` | Wizard |  |'), /Unknown access level/);
  assert.throws(() => parseApiReference('| GET | /x | Public |  |'), /backticked path/);
});
