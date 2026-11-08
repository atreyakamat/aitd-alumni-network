/**
 * Sections of the (main) app that anonymous visitors may browse (PRD 6.1).
 * Everything else under (main) requires a session and redirects to /login.
 */
export const PUBLIC_SECTIONS = [
  { href: '/events', label: 'Events' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/news', label: 'News' },
  { href: '/donations', label: 'Donate' },
  { href: '/chapters', label: 'Chapters' },
] as const;

/**
 * Shareable post links (`/posts/<id>`) open for anonymous visitors too; the API decides what they
 * may see (public posts only). So does `/search`: the API answers visitors with public content only
 * (events, news, chapters) and the page tells them to sign in for the rest. Neither is a nav section,
 * so they are not in PUBLIC_SECTIONS.
 */
export const PUBLIC_DEEP_LINK_PREFIXES = ['/posts', '/search'] as const;

export const PUBLIC_PATH_PREFIXES: readonly string[] = [...PUBLIC_SECTIONS.map((s) => s.href), ...PUBLIC_DEEP_LINK_PREFIXES];

/** True when `pathname` is a public section or nested under one (segment-prefix match). */
export function isPublicPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * Validate a post-login return path. Only same-origin relative paths are allowed:
 * must start with a single "/" (not "//" or "/\"), no backslashes or control
 * characters, and never point back at an auth page.
 */
export function getSafeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  if (/^\/(login|register)(?:[/?#]|$)/.test(value)) return null;
  // Dot segments are collapsed by the URL parser: "/.//evil.example" resolves to the PATH "//evil.example", which the
  // router then hands to history.pushState as a protocol-relative (cross-origin) URL. Only accept what stays put.
  try {
    const resolved = new URL(value, 'http://aitd.invalid');
    if (resolved.origin !== 'http://aitd.invalid' || resolved.pathname.startsWith('//')) return null;
  } catch {
    return null;
  }
  return value;
}

const buildAuthHref = (base: '/login' | '/register', nextPath?: string | null, extra: Record<string, string> = {}) => {
  const parts = Object.entries(extra).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  const safe = getSafeNextPath(nextPath);
  if (safe && safe !== '/') parts.push(`next=${encodeURIComponent(safe)}`);
  return parts.length ? `${base}?${parts.join('&')}` : base;
};

/** `/login?next=<path>` for a safe path, otherwise plain `/login`. `extra` params come first. */
export function buildLoginHref(nextPath?: string | null, extra?: Record<string, string>): string {
  return buildAuthHref('/login', nextPath, extra);
}

/** `/register?next=<path>` for a safe path, otherwise plain `/register`. */
export function buildRegisterHref(nextPath?: string | null): string {
  return buildAuthHref('/register', nextPath);
}

/**
 * Pages that live OUTSIDE the (main) route group and are open to everyone: the landing page,
 * the auth screens (they must be reachable without a session) and the legal pages.
 * Keep in sync with `src/app/(auth)`, `src/app/(legal)` and `src/app/page.tsx`;
 * `route-access.test.ts` scans the app directory and fails if a route is missing here.
 */
export const OPEN_PATH_PREFIXES: readonly string[] = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/privacy',
  '/terms',
  '/contact',
  '/cookies',
];

const normalizePath = (pathname: string) => pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

const matchesPrefix = (path: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/**
 * True for every page that needs a session: i.e. anything that is not the landing page, not an
 * auth/legal page and not a PUBLIC_PATH_PREFIXES section. Fail-closed: an unknown path counts as
 * member-only, so a new (main) route is protected by default. Static assets never reach this
 * (the middleware matcher skips them).
 */
export function isMemberOnlyPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = normalizePath(pathname);
  if (path === '/') return false;
  if (isPublicPath(path)) return false;
  if (matchesPrefix(path, OPEN_PATH_PREFIXES)) return false;
  return true;
}
