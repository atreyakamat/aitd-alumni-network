/**
 * The platform is PRIVATE: only ONE section of the (main) app is open to visitors, /donations (alumni donate as guests,
 * without an account: the page shows a visitor the donation form and nothing else). Everything else there (events,
 * gallery, news, chapters, search, shared post links, profiles ...) needs a signed-in, APPROVED member; a visitor who
 * opens such a link is sent to /login?next=<that link> and lands on it after signing in.
 *
 * These lists stay the single place that classifies a path, and opening another section to the public is a deliberate,
 * reviewed edit with a failing test (route-access.test.ts and public-paths.test.ts pin them). The pages visitors may
 * use are the landing page, this section and the pages in OPEN_PATH_PREFIXES below.
 */
export const PUBLIC_SECTIONS: readonly { readonly href: string; readonly label: string }[] = [{ href: '/donations', label: 'Donate' }];

/** Deep links (shared posts, search ...) that open for visitors. None: a shared link asks for a sign-in first. */
export const PUBLIC_DEEP_LINK_PREFIXES: readonly string[] = [];

export const PUBLIC_PATH_PREFIXES: readonly string[] = [...PUBLIC_SECTIONS.map((s) => s.href), ...PUBLIC_DEEP_LINK_PREFIXES];

/** True when `pathname` is a public section or nested under one (segment-prefix match): `/donations` and `/donations/...` only. */
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
 * the auth screens (they must be reachable without a session) and the legal and contact pages.
 * This, plus the landing page and the PUBLIC_PATH_PREFIXES section (/donations, the guest donation form), is the WHOLE allow-list of the private platform.
 * Keep in sync with `src/app/(auth)`, `src/app/(legal)` and `src/app/page.tsx`;
 * `route-access.test.ts` scans the app directory and fails if a route is missing here.
 */
export const OPEN_PATH_PREFIXES: readonly string[] = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/privacy',
  '/terms',
  '/contact',
  '/cookies',
];

const normalizePath = (pathname: string) => pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';

const matchesPrefix = (path: string, prefixes: readonly string[]) =>
  prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

/**
 * True for every page that needs a session: i.e. anything that is not the landing page and not an
 * auth/legal page (and not a PUBLIC_PATH_PREFIXES section: only /donations). Fail-closed: an unknown path counts as
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
