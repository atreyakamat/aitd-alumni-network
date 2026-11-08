import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_LINK_REL, openExternal, safeHref, safeInternalPath, safeMediaSrc } from '@/lib/safe-url';

describe('safeHref', () => {
  it.each([
    'https://example.com',
    'http://example.com/a?b=c#d',
    'HTTPS://EXAMPLE.COM/x',
    'mailto:a@b.co',
    'mailto:a@b.co?subject=Hi%20there',
    '  https://example.com/padded  ',
  ])('allows %s', (u) => expect(safeHref(u)).toBe(u.trim()));

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    '\u0001javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'java\r\n\tscript:alert(1)',
    'jav&#x09;ascript:alert(1)',
    '\tjavascript:alert(1)',
    'javascript\u0000:alert(1)',
    'java​script:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/uuid',
    'ftp://example.com/file',
    'about:blank',
    '//evil.com',
    '///evil.com',
    '\\\\evil.com',
    '/\\evil.com',
    'ｊａｖａｓｃｒｉｐｔ:alert(1)', // full-width look-alike: not a scheme
    'javascript://%0Aalert(1)',
    'https://trusted.com@evil.com',
    'https://',
    'java script:alert(1)',
    'example.com',
    '',
    '   ',
    'tel:+911234567890', // tel only with allowTel
  ])('rejects %j', (u) => expect(safeHref(u)).toBeUndefined());

  it.each([null, undefined, 42, {}, [], true])('rejects non-string %j', (u) => expect(safeHref(u)).toBeUndefined());

  it('strips smuggled control characters from allowed URLs', () => {
    expect(safeHref('ht\ttps://exa\nmple.com/pa\rth')).toBe('https://example.com/path');
  });

  it('allows relative internal paths only when asked', () => {
    expect(safeHref('/events/1')).toBeUndefined();
    expect(safeHref('/events/1?x=1', { allowRelative: true })).toBe('/events/1?x=1');
    expect(safeHref('//evil.com', { allowRelative: true })).toBeUndefined();
    expect(safeHref('/\\evil.com', { allowRelative: true })).toBeUndefined();
    // "/<tab>/evil.com" becomes "//evil.com" once a browser drops the tab, so control chars go first
    expect(safeHref('/\t/evil.com', { allowRelative: true })).toBeUndefined();
  });

  it('allows tel: only when asked and only for phone-like values', () => {
    expect(safeHref('tel:+91 98765-43210', { allowTel: true })).toBe('tel:+91 98765-43210');
    expect(safeHref('tel:javascript:alert(1)', { allowTel: true })).toBeUndefined();
    expect(safeHref('javascript:alert(1)', { allowTel: true, allowRelative: true })).toBeUndefined();
  });
});

describe('safeInternalPath', () => {
  it('accepts same-origin paths', () => {
    expect(safeInternalPath('/jobs/1?x=y#z')).toBe('/jobs/1?x=y#z');
  });
  it.each(['https://example.com/', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'jobs/1', '', null, undefined])(
    'rejects %j',
    (u) => expect(safeInternalPath(u)).toBeUndefined()
  );
  it('does not let a smuggled tab create a protocol-relative URL', () => {
    expect(safeInternalPath('/\t/evil.com')).toBeUndefined();
  });
});

describe('safeMediaSrc', () => {
  it.each(['https://cdn.example.com/a.png', 'http://localhost:5000/uploads/a.mp4', '/uploads/posts/a.jpg'])('allows %s', (u) =>
    expect(safeMediaSrc(u)).toBe(u)
  );
  it.each([
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml,<svg onload=alert(1)>',
    'vbscript:x',
    'blob:https://example.com/x',
    '//evil.com/uploads/a.png',
    '/\\evil.com/uploads/a.png',
    '/other/a.png',
    '/uploads/../../etc/passwd',
    'uploads/a.png',
    'mailto:a@b.co',
    '',
    null,
    undefined,
    7,
  ])('rejects %j', (u) => expect(safeMediaSrc(u)).toBeUndefined());
});

describe('openExternal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('opens safe URLs with noopener', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal('https://meet.example.com/j/1')).toBe(true);
    expect(open).toHaveBeenCalledWith('https://meet.example.com/j/1', '_blank', 'noopener,noreferrer');
  });
  it('refuses javascript: URLs', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openExternal('java\tscript:alert(1)')).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

it('EXTERNAL_LINK_REL carries the full hardening set', () => {
  for (const token of ['noopener', 'noreferrer', 'nofollow', 'ugc']) expect(EXTERNAL_LINK_REL).toContain(token);
});
