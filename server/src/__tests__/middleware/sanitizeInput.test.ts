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

  it('strips dangerous protocols even when control characters are smuggled inside the scheme', () => {
    const inputs = [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'java\rscript:alert(1)',
      'j a v a s c r i p t :alert(1)',
      'java\u0000script:alert(1)',
      'vb\tscript:msgbox(1)',
    ];
    for (const input of inputs) {
      const out = sanitizeValue(input) as string;
      // eslint-disable-next-line no-control-regex -- the control characters are the point of this test
      expect(out.replace(/[\s\u0000-\u001f]/g, '')).not.toMatch(/^(javascript|vbscript):/i);
    }
  });

  it('strips unclosed tags that carry attributes, but leaves ordinary text with < alone', () => {
    expect(sanitizeValue('Hi <img src=x onerror=alert(1)')).toBe('Hi');
    expect(sanitizeValue('<svg onload=alert(1)')).toBe('');
    expect(sanitizeValue('text <a href="x" onclick=evil() more <b>bold</b>')).not.toMatch(/onclick/i);
    expect(sanitizeValue('salary < 5 LPA and 3 < 4')).toBe('salary < 5 LPA and 3 < 4');
    expect(sanitizeValue('use a <b to start')).toBe('use a <b to start');
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

  it('sanitizes free-text fields even when their name ends like a credential field (referralCode, qrCode, ...)', () => {
    const req: Partial<Request> = {
      body: { referralCode: '<img src=x onerror=alert(1)>ABC', inviteCode: '<b>X1</b>', bio: '<i>hi</i>' },
      query: {},
      params: {},
    };
    run(req);
    expect(req.body).toEqual({ referralCode: 'ABC', inviteCode: 'X1', bio: 'hi' });
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
