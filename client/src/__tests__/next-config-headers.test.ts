// @vitest-environment node
import { createRequire } from 'module';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const require_ = createRequire(import.meta.url);
const CONFIG_PATH = path.resolve(__dirname, '../../next.config.js');

const ENV_KEYS = ['NODE_ENV', 'NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_MAP_TILE_URL'] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
const mutableEnv = process.env as Record<string, string | undefined>;
const saved: Env = {};
for (const k of ENV_KEYS) saved[k] = mutableEnv[k];

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete mutableEnv[k];
    else mutableEnv[k] = saved[k];
  }
  delete require_.cache[CONFIG_PATH];
});

async function load(env: Env = {}) {
  for (const k of ENV_KEYS) {
    const v = env[k];
    if (v === undefined) delete mutableEnv[k];
    else mutableEnv[k] = v;
  }
  delete require_.cache[CONFIG_PATH];
  const config = require_(CONFIG_PATH);
  const entries: Array<{ source: string; headers: Array<{ key: string; value: string }> }> = await config.headers();
  const forSource = (source: string) => {
    const entry = entries.find((e) => e.source === source);
    if (!entry) throw new Error(`no header entry for ${source}`);
    return Object.fromEntries(entry.headers.map((h) => [h.key, h.value])) as Record<string, string>;
  };
  return { config, entries, global: forSource('/:path*'), forSource };
}

const csp = (value: string) =>
  Object.fromEntries(
    value
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...sources] = d.split(' ');
        return [name, sources];
      })
  ) as Record<string, string[]>;

describe('next.config.js security headers', () => {
  it('disables X-Powered-By', async () => {
    const { config } = await load();
    expect(config.poweredByHeader).toBe(false);
  });

  it('applies the baseline headers to every route', async () => {
    const { global } = await load({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://api.aitd.example/api' });
    expect(global['X-Frame-Options']).toBe('DENY');
    expect(global['X-Content-Type-Options']).toBe('nosniff');
    expect(global['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(global['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(self), payment=(self)');
    expect(global['Content-Security-Policy']).toBeTruthy();
  });

  it('builds a strict CSP with the API origin, ws/wss, tiles and Razorpay', async () => {
    const { global } = await load({
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_URL: 'https://api.aitd.example/api',
      NEXT_PUBLIC_MAP_TILE_URL: 'https://{s}.tiles.example.org/{z}/{x}/{y}.png',
    });
    const c = csp(global['Content-Security-Policy']);

    expect(c['default-src']).toEqual(["'self'"]);
    expect(c['object-src']).toEqual(["'none'"]);
    expect(c['base-uri']).toEqual(["'self'"]);
    expect(c['form-action']).toEqual(["'self'"]);
    expect(c['frame-ancestors']).toEqual(["'none'"]);

    // Next 14 inlines bootstrap scripts, so 'unsafe-inline' is required; no eval in production.
    expect(c['script-src']).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com']));
    expect(c['script-src']).not.toContain("'unsafe-eval'");
    expect(c['style-src']).toEqual(["'self'", "'unsafe-inline'"]);

    expect(c['img-src']).toEqual(
      expect.arrayContaining([
        "'self'",
        'data:',
        'blob:',
        'https:',
        'https://api.aitd.example',
        'https://tile.openstreetmap.org',
        'https://*.tile.openstreetmap.org',
        'https://*.tiles.example.org',
      ])
    );
    expect(c['media-src']).toEqual(["'self'", 'blob:', 'https://api.aitd.example']);
    expect(c['connect-src']).toEqual(
      expect.arrayContaining(["'self'", 'https://api.aitd.example', 'wss://api.aitd.example', 'https://api.razorpay.com'])
    );
    expect(c['connect-src'].join(' ')).not.toMatch(/nominatim/);
    expect(c['frame-src']).toEqual(expect.arrayContaining(['https://checkout.razorpay.com', 'https://api.razorpay.com']));
    expect(c['font-src']).toEqual(expect.arrayContaining(["'self'", 'data:']));
  });

  it('never allows wildcard sources for scripts, connect, frames or objects', async () => {
    const { global } = await load({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://api.aitd.example/api' });
    const c = csp(global['Content-Security-Policy']);
    for (const d of ['script-src', 'connect-src', 'frame-src', 'object-src', 'default-src']) {
      expect(c[d], d).not.toContain('*');
      expect(c[d], d).not.toContain('https:');
      expect(c[d], d).not.toContain('http:');
    }
  });

  it('maps an http API origin to ws:// and keeps its port', async () => {
    const { global } = await load({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'http://10.0.0.5:5050/api' });
    const c = csp(global['Content-Security-Policy']);
    expect(c['connect-src']).toEqual(expect.arrayContaining(['http://10.0.0.5:5050', 'ws://10.0.0.5:5050']));
    expect(c['img-src']).toContain('http://10.0.0.5:5050');
    expect(c['media-src']).toContain('http://10.0.0.5:5050');
  });

  it('falls back to http://localhost:5050 when the API url is missing or invalid', async () => {
    for (const NEXT_PUBLIC_API_URL of [undefined, '', 'not a url']) {
      const { global } = await load({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL });
      const c = csp(global['Content-Security-Policy']);
      expect(c['connect-src'], String(NEXT_PUBLIC_API_URL)).toEqual(expect.arrayContaining(['http://localhost:5050', 'ws://localhost:5050']));
    }
  });

  it('adds nothing extra for a same-origin relative API path', async () => {
    const { global } = await load({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: '/api' });
    const c = csp(global['Content-Security-Policy']);
    expect(c['connect-src']).not.toContain('http://localhost:5050');
    expect(c['media-src']).toEqual(["'self'", 'blob:']);
  });

  it('sends HSTS only in production', async () => {
    const prod = await load({ NODE_ENV: 'production' });
    expect(prod.global['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/);
    const dev = await load({ NODE_ENV: 'development' });
    expect(dev.global['Strict-Transport-Security']).toBeUndefined();
  });

  it('allows eval and HMR websockets only outside production', async () => {
    const dev = csp((await load({ NODE_ENV: 'development' })).global['Content-Security-Policy']);
    expect(dev['script-src']).toContain("'unsafe-eval'");
    const prod = csp((await load({ NODE_ENV: 'production' })).global['Content-Security-Policy']);
    expect(prod['script-src']).not.toContain("'unsafe-eval'");
    expect(prod['connect-src'].join(' ')).not.toMatch(/localhost:\*/);
  });

  it('serves /login like every other route: the one-time-code hand-off that needed its own Referrer-Policy is gone', async () => {
    const { entries, global } = await load({ NODE_ENV: 'production' });
    expect(entries.map((e) => e.source)).not.toContain('/login');
    expect(global['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('allows no sign-in provider in the CSP (no Google or LinkedIn host, no extra form-action target)', async () => {
    const { global } = await load({ NODE_ENV: 'production' });
    const policy = global['Content-Security-Policy'];
    expect(policy).not.toMatch(/google|linkedin|licdn/i);
    expect(csp(policy)['form-action']).toEqual(["'self'"]);
  });

  it('does not run the image optimizer (no /_next/image proxy for arbitrary https hosts)', async () => {
    const { config } = await load();
    // Uploaded images are re-encoded and size-capped by the API; the optimizer would only add an open
    // fetch-any-URL endpoint (remotePatterns "**") and its own CVE surface.
    expect(config.images.unoptimized).toBe(true);
    expect(JSON.stringify(config.images)).not.toContain('**');
    expect(config.images.remotePatterns ?? []).toEqual([]);
  });

  it('keeps the rewrites to the API working', async () => {
    const { config } = await load({ NEXT_PUBLIC_API_URL: 'https://api.aitd.example/api' });
    expect(await config.rewrites()).toEqual([{ source: '/api/:path*', destination: 'https://api.aitd.example/api/:path*' }]);
  });
});
