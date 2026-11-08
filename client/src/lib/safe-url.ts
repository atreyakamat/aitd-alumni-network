/**
 * URL safety helpers for anything rendered from API / user-supplied data.
 *
 * Why this exists: the API stores some URLs verbatim (e.g. `java\tscript:alert(1)` passes
 * zod's `.url()` because the WHATWG parser silently drops tabs/newlines), and React does not
 * sanitise `href` / `src` values. A `javascript:` or `data:text/html` href would execute on
 * click. Every `href={…}`, `window.open(…)` or `router.push(…)` fed by data must go through
 * `safeHref` / `safeInternalPath`; every media `src` through `safeMediaSrc`.
 *
 * The helpers are allow-lists (http/https/mailto/tel), never block-lists, and they return the
 * cleaned string (control characters removed) so what we validate is exactly what the browser
 * would navigate to.
 */

/** Characters browsers drop or ignore inside a URL: C0/C1 controls, zero-width and bidi marks, BOM. */
const IGNORED_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], // C0 controls incl. tab, LF, CR
  [0x007f, 0x009f], // DEL + C1 controls
  [0x00ad, 0x00ad], // soft hyphen
  [0x200b, 0x200f], // zero-width + LRM/RLM
  [0x2028, 0x202e], // line/paragraph separators + bidi embeddings
  [0x2060, 0x2064], // word joiner & invisible operators
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
];
const hex4 = (n: number) => n.toString(16).padStart(4, '0');
const IGNORED_CHARS = new RegExp(
  `[${IGNORED_RANGES.map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join('')}]`,
  'g'
);

/** `scheme:` prefix per RFC 3986 (ASCII only, so full-width look-alikes are NOT a scheme). */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

export interface SafeHrefOptions {
  /** Allow same-origin absolute paths such as `/events/1`. Off by default: external-data context. */
  allowRelative?: boolean;
  /** Allow `tel:` links (only where phone numbers are rendered as links). */
  allowTel?: boolean;
}

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(IGNORED_CHARS, '').trim();
  return cleaned ? cleaned : null;
}

/** `/path` that stays on this origin: no `//host`, no backslash tricks, no control characters. */
function isSameOriginPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//') || value.includes('\\')) return false;
  // "/.//evil.example" and "/a/..//evil.example" collapse to the protocol-relative path "//evil.example"
  try {
    const resolved = new URL(value, 'http://aitd.invalid');
    if (resolved.origin !== 'http://aitd.invalid' || resolved.pathname.startsWith('//')) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Return a URL that is safe to put in an `href`, or `undefined` when it is not.
 * Allowed: http:, https:, mailto: (+ tel: with `allowTel`, + `/internal` paths with `allowRelative`).
 */
export function safeHref(url: unknown, options: SafeHrefOptions = {}): string | undefined {
  const value = clean(url);
  if (!value) return undefined;

  const scheme = SCHEME.exec(value);
  if (!scheme) {
    // No scheme: only an internal absolute path is acceptable, and only when the caller expects one.
    return options.allowRelative && isSameOriginPath(value) ? value : undefined;
  }

  const protocol = `${scheme[1].toLowerCase()}:`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== protocol) return undefined;

  switch (protocol) {
    case 'http:':
    case 'https:':
      // Reject `https://trusted.com@evil.com` style credentials and host-less URLs.
      if (!parsed.hostname || parsed.username || parsed.password) return undefined;
      return value;
    case 'mailto:':
      return parsed.pathname || parsed.search ? value : undefined;
    case 'tel:':
      return options.allowTel && /^tel:\+?[0-9().\-\s;,#*pw]+$/i.test(value) ? value : undefined;
    default:
      return undefined;
  }
}

/** Same-origin path (`/events/1?x=1`) or undefined. Never an absolute URL, never `//host`. */
export function safeInternalPath(url: unknown): string | undefined {
  const value = clean(url);
  return value && isSameOriginPath(value) ? value : undefined;
}

/**
 * Return a URL that is safe to use as an image / video / poster `src`, or `undefined`.
 * Allowed: http(s) URLs and same-origin `/uploads/…` paths (the API upload route).
 */
export function safeMediaSrc(url: unknown): string | undefined {
  const value = clean(url);
  if (!value) return undefined;
  if (SCHEME.test(value)) {
    const href = safeHref(value);
    return href && /^https?:/i.test(href) ? href : undefined;
  }
  // Encoded dots, slashes and backslashes are dot segments / separators once the browser resolves the URL
  // ("/uploads/%2e%2e/api/auth/me" is "/api/auth/me"); generated upload names never contain them.
  if (isSameOriginPath(value) && /^\/uploads\//.test(value) && !/(^|\/)\.\.?(\/|$)/.test(value) && !/%(2e|2f|5c)/i.test(value)) {
    return value;
  }
  return undefined;
}

/** `rel` for links to user-supplied external URLs. */
export const EXTERNAL_LINK_REL = 'noopener noreferrer nofollow ugc';

/** Props for an `<a>` pointing at a user-supplied external URL. Spread after `href`. */
export const externalLinkProps = { target: '_blank', rel: EXTERNAL_LINK_REL } as const;

/**
 * Open a user-supplied URL in a new tab if (and only if) it is a safe http(s)/mailto URL.
 * Returns whether a window was opened.
 */
export function openExternal(url: unknown): boolean {
  const href = safeHref(url);
  if (!href || typeof window === 'undefined') return false;
  window.open(href, '_blank', 'noopener,noreferrer');
  return true;
}
