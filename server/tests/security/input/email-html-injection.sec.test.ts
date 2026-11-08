/**
 * HTML injection in transactional emails (server/src/utils/email.ts).
 *
 * `name`/`inviterName` are interpolated directly into raw HTML template
 * strings. Only `sendPasswordChangedEmail` escapes it (via the module-local
 * `escapeEmailHtml`); `sendVerificationEmail`, `sendWelcomeEmail` and
 * `sendInviteEmail` do not. A user's `fullName` reaches `sendVerificationEmail`
 * / `sendWelcomeEmail` straight from registration input (after sanitizeInput,
 * which strips well-formed tags but — per sanitizer-bypass.sec.test.ts — not
 * an unclosed tag). `inviterName` in `sendInviteEmail` is also interpolated
 * unescaped into the email SUBJECT line.
 *
 * No SMTP is configured in the test env (tests/env.ts deletes SMTP_USER/PASS),
 * so `sendEmail` takes the console.log fallback branch, which we capture here
 * — no real email is sent and no network call is made.
 */
import {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordChangedEmail,
  sendInviteEmail,
} from '../../../src/utils/email';

const PAYLOAD = '<img src=x onerror=alert(document.cookie)>';

const captureHtmlLog = async (run: () => Promise<void>): Promise<string> => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await run();
    return logSpy.mock.calls.map((args) => String(args[0])).join('\n');
  } finally {
    logSpy.mockRestore();
  }
};

describe('email templates: HTML injection via unescaped name interpolation', () => {
  it('[VULNERABLE] sendVerificationEmail embeds the name unescaped', async () => {
    const log = await captureHtmlLog(() => sendVerificationEmail('victim@test.com', PAYLOAD, 'tok'));
    expect(log).not.toContain(PAYLOAD);
  });

  it('[VULNERABLE] sendWelcomeEmail embeds the name unescaped', async () => {
    const log = await captureHtmlLog(() => sendWelcomeEmail('victim@test.com', PAYLOAD));
    expect(log).not.toContain(PAYLOAD);
  });

  it('[VULNERABLE] sendInviteEmail embeds inviterName unescaped in HTML body and Subject header', async () => {
    const log = await captureHtmlLog(() => sendInviteEmail('victim@test.com', PAYLOAD, 'tok'));
    expect(log).not.toContain(PAYLOAD);
  });

  it('control: sendPasswordChangedEmail DOES escape the name (escapeEmailHtml is applied here)', async () => {
    const log = await captureHtmlLog(() => sendPasswordChangedEmail('victim@test.com', PAYLOAD));
    expect(log).not.toContain(PAYLOAD);
    expect(log).toContain('&lt;img');
  });
});
