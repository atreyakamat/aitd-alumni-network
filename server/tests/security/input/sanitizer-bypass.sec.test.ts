/**
 * Direct unit-level exploit tests against `sanitizeValue` / `sanitizeInput`
 * (src/middleware/sanitizeInput.ts). Each test asserts the SECURE expected
 * behaviour, so a FAILING test confirms a sanitizer bypass.
 *
 * Authorized local red-team test (see server/tests/security). Does not touch
 * server/src — read-only exploit proof against the existing middleware.
 */
import { sanitizeValue, sanitizeInput } from '../../../src/middleware/sanitizeInput';

describe('sanitizeInput: tag stripping', () => {
  it('neutralizes a well-formed <script> block (control: this one is correctly blocked)', () => {
    const input = '<script>alert(document.cookie)</script>hello';
    const out = sanitizeValue(input) as string;
    expect(out).not.toMatch(/<script/i);
    expect(out).toContain('hello');
  });

  it('neutralizes nested-tag reconstruction of <script> (control: SCRIPT_BLOCK + HTML_TAG together catch it)', () => {
    // Classic single-pass-regex evasion: <scr<script>ipt>...<scr</script>ipt>
    // collapses to <script>...</script> if the stripper only runs once. This
    // sanitizer happens to still catch it because SCRIPT_BLOCK greedily
    // consumes the whole span down to the real closing tag first.
    const input = '<scr<script>ipt>alert(1)<scr</script>ipt>';
    const out = sanitizeValue(input) as string;
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toContain('alert(1)');
  });

  // CONFIRMED BYPASS: HTML_TAG = /<\/?[a-z!][^<>]*>/gi requires a closing
  // '>'. An attribute-based payload with no closing bracket never matches,
  // so it survives completely untouched.
  it('[VULNERABLE] should neutralize an unclosed <img onerror> tag', () => {
    const input = 'Hi <img src=x onerror=alert(document.cookie)';
    const out = sanitizeValue(input) as string;
    expect(out).not.toMatch(/onerror\s*=/i);
    expect(out).not.toContain('<img');
  });

  it('[VULNERABLE] should neutralize an unclosed <svg onload> tag', () => {
    const input = '<svg onload=alert(1)';
    const out = sanitizeValue(input) as string;
    expect(out).not.toMatch(/onload\s*=/i);
  });
});

describe('sanitizeInput: dangerous-protocol stripping', () => {
  it('strips a bare javascript: URI (control)', () => {
    expect(sanitizeValue('javascript:alert(1)')).not.toMatch(/^javascript:/i);
  });

  it('strips a case-varied JaVaScRiPt: URI (control)', () => {
    expect(sanitizeValue('JaVaScRiPt:alert(1)')).not.toMatch(/javascript:/i);
  });

  it('strips a leading-whitespace-padded javascript: URI (control)', () => {
    expect(sanitizeValue('   javascript:alert(1)')).not.toMatch(/javascript:/i);
  });

  // CONFIRMED BYPASS: DANGEROUS_PROTOCOL = /^\s*(javascript|vbscript|data:text\/html)\s*:?/i
  // requires the literal word "javascript" to be contiguous. A single control
  // character (tab/newline/CR) inside the scheme name defeats the regex, yet
  // both the WHATWG URL parser (Node's `URL`, used by zod's `.url()`) and
  // browsers strip ASCII tab/newline/CR from a URL before parsing it, so the
  // stored value is still interpreted as `javascript:alert(...)` wherever it
  // is later parsed as a URL (see stored-xss-url-schemes.sec.test.ts).
  it('[VULNERABLE] should strip a tab-smuggled java\\tscript: URI', () => {
    const input = 'java\tscript:alert(document.cookie)';
    const out = sanitizeValue(input) as string;
    const normalized = out.replace(/[\t\n\r]/g, '');
    expect(normalized).not.toMatch(/^javascript:/i);
  });

  it('[VULNERABLE] should strip a newline-smuggled java\\nscript: URI', () => {
    const input = 'java\nscript:alert(document.cookie)';
    const out = sanitizeValue(input) as string;
    const normalized = out.replace(/[\t\n\r]/g, '');
    expect(normalized).not.toMatch(/^javascript:/i);
  });

  it('does not catch data:image/svg+xml (only data:text/html is matched) — suspected, low direct impact here', () => {
    const input = 'data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+';
    const out = sanitizeValue(input) as string;
    // Documents current behaviour; this protocol is NOT stripped by the middleware today.
    expect(out).toContain('data:image/svg+xml');
  });
});

describe('sanitizeInput: field-name allowlist (RAW_FIELD_PATTERN)', () => {
  // RAW_FIELD_PATTERN = /(password|token|signature|secret|otp|code)$/i skips
  // sanitization entirely for any key ending in those suffixes. This is safe
  // today only because no user-facing free-text field in prisma/schema.prisma
  // happens to end in one of those suffixes; it is a latent trap for the next
  // field added (e.g. "referralCode", "inviteCode", "qrCode").
  it('a "...Code"-suffixed free-text field is still sanitized (explicit raw-field list, not a suffix pattern)', (done) => {
    const req: any = { body: { referralCode: '<img src=x onerror=alert(1)>', fullName: '<b>x</b>' } };
    sanitizeInput(req, {} as any, () => {
      try {
        expect(req.body.referralCode).not.toMatch(/<|onerror/i);
        // ...and an ordinary field is sanitized as before.
        expect(req.body.fullName).not.toContain('<b>');
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('strips __proto__/constructor/prototype keys (control: prototype-pollution guard works)', (done) => {
    const req: any = { body: JSON.parse('{"__proto__":{"polluted":true},"name":"ok"}') };
    sanitizeInput(req, {} as any, () => {
      try {
        expect((req.body as any).polluted).toBeUndefined();
        expect(({} as any).polluted).toBeUndefined();
        done();
      } catch (e) {
        done(e as Error);
      }
    });
  });

  it('strips embedded NUL bytes (control)', () => {
    expect(sanitizeValue('abc\u0000def')).toBe('abcdef');
  });
});
