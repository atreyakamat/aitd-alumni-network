const path = require('path');

// ---------------------------------------------------------------------------
// Security headers (evaluated once when the config loads, from env, with safe fallbacks)
// ---------------------------------------------------------------------------
const isProd = process.env.NODE_ENV === 'production';

/** Origin used when NEXT_PUBLIC_API_URL is unset/invalid (matches the local dev API port). */
const FALLBACK_API_ORIGIN = 'http://localhost:5050';

/**
 * Absolute API origin from NEXT_PUBLIC_API_URL, '' when the API is same-origin (relative path such
 * as "/api", already covered by 'self'), or the localhost fallback when unset/invalid.
 */
function resolveApiOrigin(value) {
  const raw = (value || '').trim();
  if (raw.startsWith('/')) return '';
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  } catch {
    // fall through to the fallback
  }
  return FALLBACK_API_ORIGIN;
}

/** Tile server sources for NEXT_PUBLIC_MAP_TILE_URL ("{s}" subdomain templates become a wildcard host). */
function tileSources(template) {
  const raw = (template || '').trim();
  if (!raw) return [];
  try {
    const subdomains = /^https?:\/\/\{s\}\./i.test(raw);
    const probe = new URL(raw.replace('{s}', 'a').replace(/\{[^}]*\}/g, 'x'));
    if (probe.protocol !== 'http:' && probe.protocol !== 'https:') return [];
    return [subdomains ? `${probe.protocol}//*.${probe.host.slice(2)}` : probe.origin];
  } catch {
    return [];
  }
}

const API_ORIGIN = resolveApiOrigin(process.env.NEXT_PUBLIC_API_URL);
const API_WS_ORIGIN = API_ORIGIN.replace(/^http/, 'ws'); // http -> ws, https -> wss (socket.io)
const apiSources = API_ORIGIN ? [API_ORIGIN] : [];
const RAZORPAY_CHECKOUT = 'https://checkout.razorpay.com';
const RAZORPAY_API = 'https://api.razorpay.com';

const contentSecurityPolicy = [
  ["default-src", "'self'"],
  // Next 14 emits inline bootstrap/flight scripts, so 'unsafe-inline' is required until a per-request
  // nonce is wired through middleware (not simple with static/ISR pages). Mitigations: no remote
  // script hosts except Razorpay Checkout (donations/membership), object-src 'none', base-uri 'self'.
  // 'unsafe-eval' is only for the dev server's React Refresh.
  ["script-src", "'self'", "'unsafe-inline'", ...(isProd ? [] : ["'unsafe-eval'"]), RAZORPAY_CHECKOUT],
  ["style-src", "'self'", "'unsafe-inline'"],
  [
    "img-src",
    "'self'", 'data:', 'blob:', 'https:',
    ...apiSources,
    'https://tile.openstreetmap.org',
    'https://*.tile.openstreetmap.org',
    ...tileSources(process.env.NEXT_PUBLIC_MAP_TILE_URL),
  ],
  ["media-src", "'self'", 'blob:', ...apiSources],
  ["font-src", "'self'", 'data:'],
  [
    "connect-src",
    "'self'",
    ...apiSources,
    ...(API_WS_ORIGIN ? [API_WS_ORIGIN] : []),
    ...(isProd ? [] : ['ws://localhost:*', 'ws://127.0.0.1:*']),
    RAZORPAY_API,
    'https://lumberjack.razorpay.com',
    RAZORPAY_CHECKOUT,
  ],
  ["frame-src", RAZORPAY_CHECKOUT, RAZORPAY_API],
  ["frame-ancestors", "'none'"],
  ["base-uri", "'self'"],
  ["form-action", "'self'"],
  ["object-src", "'none'"],
]
  .map((directive) => directive.join(' '))
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // geolocation: alumni-nearby map; payment: Razorpay checkout.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
  ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Do not advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  // Docker image uses the self-contained server (see client/Dockerfile)
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  images: {
    // The image optimizer is OFF. Every upload is already re-encoded, metadata-stripped and size-capped by
    // the API (server/src/utils/storage.ts), so it added nothing, while `remotePatterns: **` turned
    // /_next/image into an open "fetch any https URL" endpoint and a large part of Next's CVE surface.
    // Remote avatars and media still render; the browser loads them directly (limited by the CSP img-src).
    unoptimized: true,
  },
  typescript: {
    // Type errors fail the build; run `npm run typecheck` locally.
    ignoreBuildErrors: false,
  },
  eslint: {
    // Lint runs during `next build` (only warnings remain; errors fail the build).
    ignoreDuringBuilds: false,
  },
  webpack: (config) => {
    config.resolve.alias['@'] = path.resolve(__dirname, 'src');
    return config;
  },
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || '/api';
    const destinationBase = apiUrl.endsWith('/api') ? apiUrl.slice(0, -4) : apiUrl;

    if (!apiUrl.startsWith('http')) {
      return [];
    }

    return [
      {
        source: '/api/:path*',
        destination: `${destinationBase}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
    ];
  },
  // npm workspaces hoist node_modules to the monorepo root (a top-level option since Next 15)
  outputFileTracingRoot: path.join(__dirname, '..'),
  experimental: {
    // NB: optimizeCss (critters) was removed — it is an optional, build-breaking dependency
    // that isn't declared here, so a clean `npm ci` build (Docker) would fail with it on.
  },
  // Enable compression
  compress: true,
};

module.exports = nextConfig;
