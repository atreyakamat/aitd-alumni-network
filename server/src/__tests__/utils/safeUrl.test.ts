import {
  assertSafeHttpUrl,
  assertSafeMediaRef,
  isSafeHttpUrl,
  isSafeMediaRef,
  normalizeUrlFields,
} from '../../utils/safeUrl';

describe('isSafeHttpUrl', () => {
  it.each([
    'https://example.com',
    'http://example.com/path?q=1#frag',
    'https://sub.example.co.in:8443/a%20b',
    '  https://example.com  ',
  ])('accepts %j', (url) => {
    expect(isSafeHttpUrl(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    'java\u0000script:alert(1)',
    'jav&#x09;ascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'file:///etc/passwd',
    'ftp://example.com/x',
    '//evil.example.com/x',
    '/relative/path',
    'https://',
    'https:///nohost',
    'https://exa mple.com',
    'https://example.com/ x',
    'https://user:pass@example.com',
    '',
    '   ',
  ])('rejects %j', (url) => {
    expect(isSafeHttpUrl(url)).toBe(false);
  });

  it('rejects non-strings and oversized values', () => {
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
    expect(isSafeHttpUrl({ toString: () => 'https://example.com' })).toBe(false);
    expect(isSafeHttpUrl(`https://example.com/${'a'.repeat(2100)}`)).toBe(false);
  });
});

describe('isSafeMediaRef', () => {
  it.each([
    'https://bucket.s3.ap-south-1.amazonaws.com/posts/1-abc.jpg',
    '/uploads/posts/1700000000000-3f2a.jpg',
    '/uploads/videos/clip.mp4',
  ])('accepts %j', (url) => {
    expect(isSafeMediaRef(url)).toBe(true);
  });

  it.each([
    '/uploads/../etc/passwd',
    '/uploads/%2e%2e/secret',
    '/uploads/a/../b.jpg',
    '/uploads/',
    '/uploads/a b.jpg',
    '/uploads\\evil',
    '/other/file.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '/uploads/x.jpg?x=<script>',
  ])('rejects %j', (url) => {
    expect(isSafeMediaRef(url)).toBe(false);
  });
});

describe('assert helpers', () => {
  it('throw a 400 AppError naming the field', () => {
    expect(() => assertSafeHttpUrl('javascript:alert(1)', 'linkUrl')).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_URL', message: expect.stringContaining('linkUrl') })
    );
    expect(() => assertSafeMediaRef('data:x', 'bannerUrl')).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_URL' })
    );
  });

  it('return the trimmed value when valid', () => {
    expect(assertSafeHttpUrl(' https://example.com/a ', 'linkUrl')).toBe('https://example.com/a');
    expect(assertSafeMediaRef('/uploads/a.jpg', 'x')).toBe('/uploads/a.jpg');
  });
});

describe('normalizeUrlFields', () => {
  it('validates present fields, clears empty ones and leaves absent ones alone', () => {
    const data: Record<string, unknown> = { link: ' https://example.com ', banner: '/uploads/a.jpg', empty: '', other: 'x' };
    normalizeUrlFields(data, { http: ['link', 'empty', 'missing'], media: ['banner'] });
    expect(data).toEqual({ link: 'https://example.com', banner: '/uploads/a.jpg', empty: null, other: 'x' });
    expect('missing' in data).toBe(false);
  });

  it('throws for an unsafe value in either group', () => {
    expect(() => normalizeUrlFields({ link: 'java	script:alert(1)' }, { http: ['link'] })).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_URL' })
    );
    expect(() => normalizeUrlFields({ banner: 'data:text/html,x' }, { media: ['banner'] })).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_URL' })
    );
  });
});
