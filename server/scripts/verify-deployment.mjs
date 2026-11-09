// Post-deploy verification: node scripts/verify-deployment.mjs --web https://alumni.example.edu [--api https://alumni.example.edu]
//
// Read-only. It never signs in and never writes anything: only GET/HEAD requests and one request with a foreign Origin.
// Run it against the real URLs right after a deploy (and after every proxy/CDN change). Exit code 1 when a check fails.
// With the nginx proxy profile web and API share one origin, so --api defaults to --web.

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const strip = (url) => (url || '').replace(/\/+$/, '');
const WEB = strip(flag('--web'));
const API = strip(flag('--api') || WEB);
const allowHttp = args.includes('--allow-http');

if (!WEB) {
  console.error('Usage: node scripts/verify-deployment.mjs --web <web url> [--api <api url>] [--allow-http]');
  process.exit(2);
}

let failures = 0;
let warnings = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const note = (name, ok, detail = '') => {
  if (!ok) warnings++;
  console.log(`${ok ? 'PASS' : 'WARN'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const get = async (url, options = {}) => {
  try {
    return await fetch(url, { redirect: 'manual', ...options });
  } catch (error) {
    return { status: 0, headers: new Headers(), error };
  }
};
const json = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

console.log(`Verifying web=${WEB} api=${API}\n`);

// ---- transport ----
check('web is served over https', WEB.startsWith('https://') || allowHttp, WEB.startsWith('https://') ? '' : 'use --allow-http only for a local trial');
check('api is served over https', API.startsWith('https://') || allowHttp);

// ---- API health and headers ----
const health = await get(`${API}/health`);
const healthBody = await json(health);
check('API health reports the database up', health.status === 200 && healthBody?.databaseStatus === 'up', `status ${health.status}`);
check('API does not advertise Express (no X-Powered-By)', !health.headers.get('x-powered-by'));
check('API sends X-Content-Type-Options: nosniff', (health.headers.get('x-content-type-options') || '').toLowerCase() === 'nosniff');

const search = await get(`${API}/api/search?q=alumni`);
check('API answers rate-limit headers (limits are active)', Boolean(search.headers.get('ratelimit-limit') || search.headers.get('x-ratelimit-limit')));
check('anonymous search is refused (the community is private)', search.status === 401, `status ${search.status}`);

// ---- access control ----
// The platform is private: every route that returns community content needs an approved member. Only the sign-in routes,
// the landing page's two pieces (/api/landing, /api/users/stats) and the payment webhook are open.
const PRIVATE_API = [
  '/api/users/directory', '/api/users/nearby', '/api/users/me/export', '/api/users/notable', '/api/admin/users', '/api/admin/stats',
  '/api/admin/approvals', '/api/notifications', '/api/messages/conversations',
  '/api/events', '/api/events/upcoming', '/api/news', '/api/news/latest', '/api/gallery/albums', '/api/gallery/recent',
  '/api/chapters', '/api/jobs', '/api/posts', '/api/hashtags/trending', '/api/videos', '/api/magazine', '/api/requirements',
  '/api/marketplace', '/api/memberships/tiers', '/api/donations/wall', '/api/donations/stats',
];
for (const path of PRIVATE_API) {
  const res = await get(`${API}${path}`);
  check(`anonymous ${path} is refused`, res.status === 401, `status ${res.status}`);
}
const donation = await fetch(`${API}/api/donations/order`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 100 }), redirect: 'manual' });
check('anonymous donation orders are refused', donation.status === 401, `status ${donation.status}`);
for (const path of ['/api/landing', '/api/users/stats']) {
  const res = await get(`${API}${path}`);
  check(`${path} (landing page) is open`, res.status === 200, `status ${res.status}`);
}
const forgedToken = await get(`${API}/api/search?q=a`, { headers: { Authorization: 'Bearer not-a-real-token' } });
check('a bad token is a 401, never a silent logged-out view', forgedToken.status === 401, `status ${forgedToken.status}`);

// ---- CORS ----
const foreign = await get(`${API}/api/events`, { headers: { Origin: 'https://evil.example' } });
check('a foreign Origin is not allowed', foreign.status === 403 || !foreign.headers.get('access-control-allow-origin'), `status ${foreign.status}`);
check('a wildcard CORS origin is never sent', foreign.headers.get('access-control-allow-origin') !== '*');

// ---- files ----
const receipt = await get(`${API}/uploads/receipts/anything.pdf`);
check('donation receipts are not served as static files', receipt.status === 404, `status ${receipt.status}`);
const traversal = await get(`${API}/uploads/x/../receipts/anything.pdf`);
check('receipts cannot be reached through ".."', traversal.status === 404, `status ${traversal.status}`);
const dotfile = await get(`${API}/uploads/.env`);
check('dotfiles are not served', dotfile.status === 404, `status ${dotfile.status}`);

// ---- web app ----
const home = await get(`${WEB}/`);
check('the public home page loads', home.status === 200, `status ${home.status}`);
check('web sends a Content-Security-Policy', Boolean(home.headers.get('content-security-policy')));
check('web forbids framing (frame-ancestors none / X-Frame-Options)', /frame-ancestors\s+'none'/.test(home.headers.get('content-security-policy') || '') || /deny/i.test(home.headers.get('x-frame-options') || ''));
check('web does not advertise Next.js (no X-Powered-By)', !home.headers.get('x-powered-by'));
if (WEB.startsWith('https://')) {
  check('web sends Strict-Transport-Security', /max-age=\d{7,}/.test(home.headers.get('strict-transport-security') || ''), 'add it at the TLS terminator');
}

for (const path of ['/dashboard', '/admin/users', '/admin/approvals', '/directory', '/messages', '/profile/x.png', '/search', '/events', '/news', '/gallery', '/chapters', '/donations', '/posts/x']) {
  const res = await get(`${WEB}${path}`);
  const location = res.headers.get('location') || '';
  check(`anonymous ${path} is sent to sign-in`, [302, 303, 307, 308].includes(res.status) && /\/login/.test(location), `status ${res.status}`);
}
for (const path of ['/login', '/register', '/verify-email']) {
  const res = await get(`${WEB}${path}`);
  check(`${path} is open to visitors`, res.status === 200, `status ${res.status}`);
}
const image = await get(`${WEB}/_next/image?url=%2Flogo.png&w=64&q=75`);
check('the Next.js image optimizer is off', image.status === 404 || image.status === 400, `status ${image.status}`);

// ---- things to look at by hand ----
const providers = await json(await get(`${API}/api/auth/oauth/providers`));
note('OAuth providers answered with booleans only', providers?.data && Object.values(providers.data).every((v) => typeof v === 'boolean'));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}${warnings ? `, ${warnings} warning(s)` : ''}`);
process.exit(failures === 0 ? 0 : 1);
