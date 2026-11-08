/**
 * ROUND 2 - sanitizer: variants of the round-1 fixes (IN-01 / IN-02) and new weaknesses introduced by them.
 * Pure functions: no database needed beyond the shared harness bootstrap.
 *
 *  - R2-01  catastrophic regex backtracking (unauthenticated event-loop DoS: sanitizeInput runs on EVERY request)
 *  - R2-02  "JavaScript Developer" lost its first word (protocol stripping did not require the colon)
 *  - R2-03  unclosed tags with an event handler survived for every element not on the allow-list
 */
import { sanitizeValue } from '../../../src/middleware/sanitizeInput';
import { isSafeHttpUrl, isSafeMediaRef } from '../../../src/utils/safeUrl';

const timed = (fn: () => unknown) => {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start) / 1e6;
};

describe('R2-01 sanitizer runs in linear time (no ReDoS)', () => {
  // A 10 MB JSON body is accepted by express.json, and sanitizeInput walks every string of it before routing.
  const BUDGET_MS = 1500;

  it('an unclosed tag whose "tag" is closed only after a stripped sibling does not backtrack quadratically', () => {
    const payload = '<img <b>' + '='.repeat(60_000) + '>';
    expect(timed(() => sanitizeValue(payload))).toBeLessThan(BUDGET_MS);
  });

  it('thousands of unclosed <script> openers do not rescan the rest of the string each time', () => {
    const payload = '<script>'.repeat(40_000);
    expect(timed(() => sanitizeValue(payload))).toBeLessThan(BUDGET_MS);
  });

  it('thousands of "<script " openers without any ">" are linear', () => {
    const payload = '<script '.repeat(60_000);
    expect(timed(() => sanitizeValue(payload))).toBeLessThan(BUDGET_MS);
  });

  it('long attribute-less and attribute-heavy inputs stay fast', () => {
    for (const payload of ['<a '.repeat(80_000), '<img '.repeat(80_000) + 'x=', '<' + 'a'.repeat(300_000), '<a ' + 'b= '.repeat(100_000)]) {
      expect(timed(() => sanitizeValue(payload))).toBeLessThan(BUDGET_MS);
    }
  });

  it('still removes the constructs the fast path replaced', () => {
    expect(sanitizeValue('a<script>alert(1)</script>b')).toBe('ab');
    expect(sanitizeValue('a<SCRIPT src=x>alert(1)</ScRiPt >b')).toBe('ab');
    expect(sanitizeValue('<style>x{}</style>t<iframe src=x></iframe>u')).toBe('tu');
    expect(sanitizeValue('<script>one</script><script>two</script>ok')).toBe('ok');
    expect(sanitizeValue('<script>never closed')).toBe('never closed');
    expect(sanitizeValue('Hi <img src=x onerror=alert(1)')).toBe('Hi');
    expect(sanitizeValue('<svg onload=alert(1)')).toBe('');
  });
});

describe('R2-02 ordinary words that merely start with a script-scheme name are kept', () => {
  it.each([
    ['JavaScript Developer', 'JavaScript Developer'],
    ['javascript tips for beginners', 'javascript tips for beginners'],
    ['VBScript to Python migration', 'VBScript to Python migration'],
    ['JavaScript', 'JavaScript'],
    ['Data science and data: text', 'Data science and data: text'],
  ])('%j is unchanged', (input, expected) => {
    expect(sanitizeValue(input)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'j a v a s c r i p t : alert(1)',
    '​javascript:alert(1)',
    ' \n javascript :alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<b>x</b>',
    'data : text / html;base64,AAA',
  ])('the scheme in %j is still removed', (input) => {
    const out = sanitizeValue(input) as string;
    // eslint-disable-next-line no-control-regex
    expect(out.replace(/[\s\u0000-\u001f\u200b-\u200f\ufeff]/g, '')).not.toMatch(/^(javascript|vbscript|data:text\/html):?/i);
  });
});

describe('R2-03 event handlers on ANY element are removed even when the tag is never closed', () => {
  const handlers = [
    '<div onmouseover=alert(1)',
    '<p onclick=alert(1)',
    '<b onclick="alert(1)"',
    '<span style=x onmouseenter=alert(1)',
    '<h1 onfocus=alert(1) autofocus',
    '<li onclick=alert(1)',
    '<td onclick=alert(1)',
    '<font onclick=alert(1)',
    '<custom-element onclick=alert(1)',
    '<DIV\nONMOUSEOVER\n=\nalert(1)',
    'text <section onpointerover=alert(1)',
    '<x/onclick=alert(1)',
  ];
  it.each(handlers)('%j carries no event handler after sanitising', (input) => {
    const out = sanitizeValue(input) as string;
    expect(out).not.toMatch(/\bon[a-z]+\s*=/i);
  });

  it('plain text containing "<" and "=" is untouched', () => {
    for (const text of ['salary < 5 LPA and 3 < 4', 'use a <b to start', 'if a<b and c=d then', 'x <y and z=3', 'score<=10 && rank>=2']) {
      expect(sanitizeValue(text)).toBe(text);
    }
  });
});

describe('R2-04 stripping one tag cannot assemble a new one out of its neighbours', () => {
  it.each([
    '<scr<b></b>ipt>alert(1)</scr<b></b>ipt>',
    '<scr<i>ipt>alert(1)</scr<i>ipt>',
    '<img src=x on<b></b>error=alert(1)>',
    '<<b></b>script>alert(1)<<b></b>/script>',
    '<ima<b></b>g src=x onerror=alert(1)>',
    '<a href="java<b></b>script:alert(1)">x</a>',
    '<<script></script>img src=x onerror=alert(1)>',
    '<scr<b><i></i></b>ipt>alert(1)</script>',
    '<<<<<<<<<<b></b></b></b></b></b></b></b></b></b>script>alert(1)',
    'javascript:javascript:alert(1)',
    '<b></b>java<b></b>script:alert(1)',
  ])('%j leaves no tag, handler or scheme behind', (input) => {
    const out = sanitizeValue(input) as string;
    expect(out).not.toMatch(/<\s*\/?\s*(script|img|a|style|iframe|svg)\b/i);
    expect(out).not.toMatch(/\bon[a-z]+\s*=/i);
    expect(out.replace(/\s/g, '')).not.toMatch(/^javascript:/i);
  });

  it('keeps ordinary text that mentions angle brackets', () => {
    expect(sanitizeValue('1 < 2 and 3 > 2')).toBe('1 < 2 and 3 > 2');
    expect(sanitizeValue('Use <b to bold')).toBe('Use <b to bold');
  });
});

describe('R2-26 safeUrl: more variants of the round-1 allowlist', () => {
  it.each([
    'http://good.com\\@evil.com',
    'https://good.com\\.evil.com/path',
    'https://good.com/a\\b',
    'https:\\\\evil.com',
    'https:/\\evil.com',
    'https://evil.com%00.good.com',
    '﻿javascript:alert(1)',
    'ｊａｖａｓｃｒｉｐｔ:alert(1)',
    'ｈｔｔｐｓ://evil.com',
    '%6Aavascript:alert(1)',
    '&#x6A;avascript:alert(1)',
    'javascript&colon;alert(1)',
    'https://user@evil.com',
    'https://good.com:pw@evil.com',
    'https://a.com/\u0001',
    'https://a.com/ x',
    'https://a.com/\u0085',
    'https://' + 'a'.repeat(2100) + '.com',
  ])('isSafeHttpUrl refuses %j', (value) => {
    expect(isSafeHttpUrl(value)).toBe(false);
  });

  it.each(['https://example.com', 'http://example.com/a/b?x=1&y=2#frag', 'HTTPS://EXAMPLE.COM/Path', 'https://xn--bcher-kva.example/', 'https://例え.jp/'])(
    'isSafeHttpUrl accepts %j',
    (value) => {
      expect(isSafeHttpUrl(value)).toBe(true);
    }
  );

  it.each([
    '/UPLOADS/x.png',
    '/uploads/../secret',
    '/uploads/%2e%2e/secret',
    '/uploads/..%2fsecret',
    '/uploads/a/./b.png',
    '/uploads\\x.png',
    '/uploads/x.png?x=1',
    '//evil.com/uploads/x.png',
    'uploads/x.png',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'blob:https://a.com/uuid',
    'javascript:alert(1)',
  ])('isSafeMediaRef refuses %j', (value) => {
    expect(isSafeMediaRef(value)).toBe(false);
  });

  it('isSafeMediaRef accepts our own upload paths and http(s)', () => {
    for (const ok of ['/uploads/a.png', '/uploads/images/2024/a_b-c.webp', 'https://cdn.example.com/a.png']) expect(isSafeMediaRef(ok)).toBe(true);
  });
});
