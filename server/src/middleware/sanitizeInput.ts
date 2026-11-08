/**
 * Input sanitization middleware
 *
 * Strips markup from user supplied strings so stored content can never carry
 * executable HTML. Output encoding is still the client's job (React escapes by
 * default); this layer removes tags rather than HTML-encoding them so URLs,
 * quotes and comparison operators in plain text survive untouched.
 *
 * This is defence in depth, not the only control: URL fields are additionally validated against an
 * http(s) allowlist (utils/safeUrl.ts) and every HTML email escapes what it interpolates.
 */

import { Request, Response, NextFunction } from 'express';

// Fields that must reach handlers byte-for-byte (credentials, one-time codes, signatures). An explicit
// list on purpose: a suffix pattern such as /(code|token)$/ silently exempted any future free-text field
// that happened to end that way (referralCode, qrCode, ...).
const RAW_FIELDS = new Set(
  [
    'password',
    'currentPassword',
    'newPassword',
    'confirmPassword',
    'token',
    'accessToken',
    'refreshToken',
    'twoFactorToken',
    'resetToken',
    'verificationToken',
    'otp',
    'code',
    'signature',
    'razorpay_signature',
  ].map((key) => key.toLowerCase())
);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Every pattern below must run in time linear in the input: this middleware walks every string of every request
// (bodies up to 10 MB, anonymous callers included) BEFORE routing, so one regex that rescans the rest of the string
// from each of many start positions ("<script>" x 40,000, a lazy [\s\S]*? search, two overlapping [^<>]* around a
// "=") is an unauthenticated way to pin the event loop for minutes. Block elements are therefore handled by
// `stripBlockElements` (each closing tag is searched for once per element name) and the unclosed-tag rule matches a
// run once and decides in a callback.
const BLOCK_ELEMENTS = ['script', 'style', 'iframe', 'object', 'embed'] as const;
type BlockElement = (typeof BLOCK_ELEMENTS)[number];
const BLOCK_OPEN = /<\s*(script|style|iframe|object|embed)/iy;
const BLOCK_CLOSE = Object.fromEntries(
  BLOCK_ELEMENTS.map((name) => [name, new RegExp(`<\\s*\\/\\s*${name}\\s*>`, 'gi')])
) as Record<BlockElement, RegExp>;
const HAS_BLOCK_OPEN = /<\s*(?:script|style|iframe|object|embed)/i;
const HTML_TAG = /<\/?[a-z!][^<>]*>/gi;
// A tag that was never closed ("<img src=x onerror=alert(1)"): HTML_TAG needs a ">" and never matches it. The element
// name and the run of attributes after it (up to the next "<" or the end, and only runs that contain an "=") are matched
// once; the callback then removes it when the element is a dangerous one, or when ANY element carries an event handler
// (on...=). "a < b", "use <b to" and "if a<b and c=d" survive.
const UNCLOSED_TAG = /<\/?([a-z][a-z0-9:-]*)(?![a-z0-9:-])([^<>=]*=[^<>]*)(?=<|$)/gi;
const DANGEROUS_ELEMENTS = new Set([
  'a', 'abbr', 'area', 'audio', 'base', 'body', 'button', 'embed', 'form', 'frame', 'head', 'html', 'iframe', 'img',
  'input', 'isindex', 'link', 'math', 'meta', 'object', 'script', 'select', 'source', 'style', 'svg', 'textarea',
  'track', 'video', 'details', 'marquee', 'template', 'animate', 'set',
]);
const EVENT_HANDLER_ATTRIBUTE = /(?:^|[\s/"'`])on[a-z]+\s*=/i;

// "java<TAB>script:" is a javascript: URL to browsers and to the WHATWG URL parser: both drop tab/CR/LF
// (and other control characters) while parsing. So the scheme is matched allowing them between letters.
// Built from code points rather than escape sequences so the intent survives any editor or shell.
const EXTRA_GAP_CHARS = [
  [0x00, 0x1f], // C0 controls (tab, LF, CR, NUL ...)
  [0x7f, 0x7f],
  [0xa0, 0xa0], // no-break space
  [0x200b, 0x200f], // zero-width and directional marks
  [0x2028, 0x2029], // line and paragraph separators
  [0xfeff, 0xfeff], // BOM / zero-width no-break space
]
  .map(([from, to]) => (from === to ? String.fromCharCode(from) : `${String.fromCharCode(from)}-${String.fromCharCode(to)}`))
  .join('');
const GAP = String.raw`[\s${EXTRA_GAP_CHARS}]*`;
const spell = (word: string) => word.split('').join(GAP);
// The colon is part of the scheme: without it "JavaScript Developer" or "VBScript to Python" are ordinary words (a job
// title used to lose its first word) and cannot be a URL anyway.
const SCRIPT_SCHEME = `(?:${spell('javascript')}|${spell('vbscript')})${GAP}:`;
const DATA_HTML = `${spell('data')}${GAP}:${GAP}${spell('text')}${GAP}/${GAP}${spell('html')}${GAP}:?`;
const DANGEROUS_PROTOCOL = new RegExp(`^${GAP}(?:${SCRIPT_SCHEME}|${DATA_HTML})`, 'i');
// "javascript:javascript:alert(1)" must not leave a working scheme behind after one removal. A capped loop (not a
// repeated regex group, which overflows V8's backtracking stack on a megabyte of "javascript:"): nothing legitimate
// starts with that many stacked schemes.
const MAX_SCHEME_STRIPS = 8;
const stripLeadingSchemes = (input: string): string => {
  let current = input;
  for (let strips = 0; strips < MAX_SCHEME_STRIPS && DANGEROUS_PROTOCOL.test(current); strips++) {
    current = current.replace(DANGEROUS_PROTOCOL, '');
  }
  return DANGEROUS_PROTOCOL.test(current) ? '' : current;
};

/** Removes `<script>...</script>` (and style/iframe/object/embed) together with their content, in linear time. */
const stripBlockElements = (input: string): string => {
  if (!HAS_BLOCK_OPEN.test(input)) return input;
  let out = '';
  let copied = 0; // input[0, copied) has been dealt with
  let from = 0; // where to look for the next "<"
  let gt = -2; // cached index of the first ">" at or after the current opener (-1: there is none left)
  const withoutCloser = new Set<BlockElement>(); // elements whose closing tag does not occur in the rest of the input

  for (;;) {
    const lt = input.indexOf('<', from);
    if (lt === -1) break;
    BLOCK_OPEN.lastIndex = lt;
    const open = BLOCK_OPEN.exec(input);
    if (!open) {
      from = lt + 1;
      continue;
    }
    const name = open[1].toLowerCase() as BlockElement;
    if (withoutCloser.has(name)) {
      from = lt + 1;
      continue;
    }
    // The opening tag ends at the first ">" after its name
    const afterName = lt + open[0].length;
    if (gt !== -1 && gt < afterName) gt = input.indexOf('>', afterName);
    if (gt === -1) break;
    const closer = BLOCK_CLOSE[name];
    closer.lastIndex = gt + 1;
    const close = closer.exec(input);
    if (!close) {
      withoutCloser.add(name);
      from = lt + 1;
      continue;
    }
    out += input.slice(copied, lt);
    copied = close.index + close[0].length;
    from = copied;
  }
  return out + input.slice(copied);
};

const stripUnclosedTags = (input: string): string =>
  input.replace(UNCLOSED_TAG, (match, name: string, attributes: string) => {
    const element = name.toLowerCase().split(':')[0];
    // the pattern only matches runs that contain an "="
    return DANGEROUS_ELEMENTS.has(element) || EVENT_HANDLER_ATTRIBUTE.test(attributes) ? '' : match;
  });

/** One pass: block elements with their content, closed tags, unclosed tags. */
const stripMarkupOnce = (input: string): string => stripUnclosedTags(stripBlockElements(input).replace(HTML_TAG, ''));

// Removing a tag can splice its neighbours into a NEW one ("<scr<b></b>ipt>" -> "<script>", "on<b></b>error=" ->
// "onerror="), so stripping repeats until nothing changes. A pass that changes the text always shortens it; the cap
// only bounds the work for adversarial nesting.
const MAX_STRIP_PASSES = 8;

const stripMarkup = (input: string): string => {
  let current = input;
  for (let pass = 0; pass < MAX_STRIP_PASSES; pass++) {
    const next = stripMarkupOnce(current);
    if (next === current) return current;
    current = next;
  }
  // Nested deeper than the cap: whatever might still assemble into a tag loses its "<"
  return current.replace(/<(?=[a-z!/])/gi, '');
};

export const sanitizeValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;

  return stripLeadingSchemes(
    stripMarkup(
      value
        // eslint-disable-next-line no-control-regex -- stripping NUL bytes is intentional
        .replace(/\u0000/g, '')
    )
  )
    // Close gaps left by removed tags; line breaks are content (bios, posts) and stay
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .trim();
};

const sanitizeObject = (obj: any): any => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeValue(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);

  if (typeof obj === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (FORBIDDEN_KEYS.has(key)) continue;
      sanitized[key] = RAW_FIELDS.has(key.toLowerCase()) ? obj[key] : sanitizeObject(obj[key]);
    }
    return sanitized;
  }

  return obj;
};

/**
 * Middleware to sanitize all request inputs
 */
export const sanitizeInput = (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export default sanitizeInput;
