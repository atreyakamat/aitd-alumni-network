import { Request, Response } from 'express';
import { sanitizeInput, sanitizeValue } from '../../middleware/sanitizeInput';

const run = (req: Partial<Request>) => {
  const next = jest.fn();
  sanitizeInput(req as Request, {} as Response, next);
  return next;
};

describe('sanitizeValue', () => {
  it('strips script blocks entirely', () => {
    expect(sanitizeValue('hi<script>alert(1)</script> there')).toBe('hi there');
  });

  it('strips html tags but keeps their text', () => {
    expect(sanitizeValue('<b>bold</b> and <img src=x onerror=alert(1)>')).toBe('bold and');
  });

  it('neutralises javascript: urls', () => {
    expect(sanitizeValue('javascript:alert(1)')).toBe('alert(1)');
  });

  it('keeps normal urls intact', () => {
    expect(sanitizeValue('https://linkedin.com/in/someone?x=1&y=2')).toBe('https://linkedin.com/in/someone?x=1&y=2');
  });

  it('keeps comparison operators and quotes in plain text', () => {
    expect(sanitizeValue(`salary > 5 LPA, "remote" isn't required`)).toBe(`salary > 5 LPA, "remote" isn't required`);
  });

  it('keeps line breaks and paragraphs in multi-line text (bios, posts, descriptions)', () => {
    expect(sanitizeValue('First line\nSecond line\n\nNew paragraph')).toBe('First line\nSecond line\n\nNew paragraph');
    expect(sanitizeValue('Windows\r\nlines')).toBe('Windows\r\nlines');
  });

  it('collapses the gaps left by removed tags without touching newlines', () => {
    expect(sanitizeValue('a <b></b>  b\n<i></i>c')).toBe('a b\nc');
  });

  it('removes null bytes', () => {
    expect(sanitizeValue('abc\u0000def')).toBe('abcdef');
  });

  it('passes through non-strings', () => {
    expect(sanitizeValue(42)).toBe(42);
    expect(sanitizeValue(true)).toBe(true);
    expect(sanitizeValue(null)).toBeNull();
  });
});

describe('sanitizeInput middleware', () => {
  it('sanitizes nested body objects and arrays', () => {
    const req: Partial<Request> = {
      body: { title: '<i>Hi</i>', tags: ['<b>a</b>', 'b'], nested: { bio: '<script>x</script>ok' } },
      query: {},
      params: {},
    };
    const next = run(req);
    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ title: 'Hi', tags: ['a', 'b'], nested: { bio: 'ok' } });
  });

  it('never alters password or token fields', () => {
    const req: Partial<Request> = {
      body: { password: '<P@ss/word>', newPassword: 'a<b>c', refreshToken: 'x.y<z>', token: '<t>' },
      query: {},
      params: {},
    };
    run(req);
    expect(req.body).toEqual({ password: '<P@ss/word>', newPassword: 'a<b>c', refreshToken: 'x.y<z>', token: '<t>' });
  });

  it('sanitizes query string values', () => {
    const req: Partial<Request> = { body: undefined, query: { q: '<script>1</script>john' } as any, params: {} };
    run(req);
    expect(req.query).toEqual({ q: 'john' });
  });

  it('ignores prototype pollution keys', () => {
    const body = JSON.parse('{"__proto__": {"admin": true}, "name": "x"}');
    const req: Partial<Request> = { body, query: {}, params: {} };
    run(req);
    expect(req.body).toEqual({ name: 'x' });
    expect(({} as any).admin).toBeUndefined();
  });
});
