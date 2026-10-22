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
 * may see (public posts only). Not a nav section, so it is not in PUBLIC_SECTIONS.
 */
export const PUBLIC_DEEP_LINK_PREFIXES = ['/posts'] as const;

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
