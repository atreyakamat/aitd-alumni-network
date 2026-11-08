/**
 * URL safety for every user-supplied link or media reference we store.
 *
 * A blocklist of "bad" schemes is never enough: browsers (and the WHATWG URL parser behind `new URL`
 * and zod's `.url()`) ignore tabs, newlines and carriage returns inside a URL, so `java\tscript:...`
 * is a `javascript:` URL even though a naive `/^javascript:/` check misses it. These helpers instead
 * ALLOW only a narrow shape: absolute http(s) URLs without control characters, whitespace or embedded
 * credentials, and (for media) our own `/uploads/...` paths.
 */
import { AppError } from '../middleware/errorHandler';

export const MAX_URL_LENGTH = 2048;

// C0/C1 controls, any whitespace (incl. line/paragraph separators), zero-width and BOM characters
const FORBIDDEN_CHARS = new RegExp(
  '[' +
    '\u0000-\u0020' +
    '\u007f-\u00a0' +
    '\u1680\u180e' +
    '\u2000-\u200f' +
    '\u2028-\u202f' +
    '\u205f-\u2064' +
    '\u3000\ufeff' +
    ']'
);
const LOCAL_UPLOAD = /^\/uploads\/[A-Za-z0-9._\-/]+$/;

const parseHttpUrl = (value: unknown): URL | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH || FORBIDDEN_CHARS.test(trimmed)) return null;
  // Scheme must be spelled out literally: "http://" or "https://" (case-insensitive), nothing smuggled
  if (!/^https?:\/\/[^/?#\\]/i.test(trimmed)) return null;
  // The WHATWG parser reads "\" as "/" in http(s) URLs ("http://good.com\@evil.com" is good.com to a browser but
  // evil.com to many other parsers), and a valid link never needs a raw backslash.
  if (trimmed.includes('\\')) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    // user:password@host links are used to disguise the real destination
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
};

/** Absolute http(s) URL, nothing else. */
export const isSafeHttpUrl = (value: unknown): value is string => parseHttpUrl(value) !== null;

/** An http(s) URL (e.g. S3) or a path under our own `/uploads/` folder, without traversal. */
export const isSafeMediaRef = (value: unknown): value is string => {
  if (isSafeHttpUrl(value)) return true;
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
  return LOCAL_UPLOAD.test(value) && !value.split('/').some((part) => part === '..' || part === '.');
};

const invalid = (field: string) =>
  new AppError(`${field} must be a valid http(s) link`, 400, 'INVALID_URL');

export const assertSafeHttpUrl = (value: unknown, field: string): string => {
  if (!isSafeHttpUrl(value)) throw invalid(field);
  return value.trim();
};

export const assertSafeMediaRef = (value: unknown, field: string): string => {
  if (!isSafeMediaRef(value)) {
    throw new AppError(`${field} must be an uploaded file or an http(s) link`, 400, 'INVALID_URL');
  }
  return value.trim();
};

/** Same as the assert helpers, but `undefined`/`null`/'' mean "no value". */
export const optionalSafeHttpUrl = (value: unknown, field: string): string | null =>
  value === undefined || value === null || value === '' ? null : assertSafeHttpUrl(value, field);

export const optionalSafeMediaRef = (value: unknown, field: string): string | null =>
  value === undefined || value === null || value === '' ? null : assertSafeMediaRef(value, field);

/**
 * Validates the named URL fields of a data object in place: `http` fields must be http(s) links,
 * `media` fields an upload path or http(s) link. Present-but-empty values become null (clearing the
 * field); absent fields are left alone, so PATCH semantics are preserved.
 */
export const normalizeUrlFields = (
  data: Record<string, unknown>,
  fields: { http?: readonly string[]; media?: readonly string[] }
): void => {
  for (const field of fields.http ?? []) {
    if (data[field] === undefined) continue;
    data[field] = optionalSafeHttpUrl(data[field], field);
  }
  for (const field of fields.media ?? []) {
    if (data[field] === undefined) continue;
    data[field] = optionalSafeMediaRef(data[field], field);
  }
};
