/**
 * How mail is sent: which server it goes through, how long a stuck server can hold a request, and what happens to a
 * transient failure. (The rest of the suite replaces utils/email with stubs, so this file loads the real module.)
 */
const actual = jest.requireActual('../../utils/email') as typeof import('../../utils/email');
const { buildTransportOptions, isTransientMailError, sendWithRetry } = actual;

const cfg = (overrides: Record<string, unknown> = {}) =>
  ({
    from: 'noreply@example.edu',
    sendgridApiKey: undefined,
    smtp: { host: 'smtp.example.edu', port: 587, user: undefined, pass: undefined },
    ...overrides,
  }) as never;

describe('buildTransportOptions', () => {
  it('sends nothing (null) without any mail configuration: development only logs the mail', () => {
    expect(buildTransportOptions(cfg())).toBeNull();
  });

  it('uses the configured SMTP server', () => {
    const options = buildTransportOptions(cfg({ smtp: { host: 'smtp.example.edu', port: 465, user: 'u', pass: 'p' } }))!;
    expect(options).toMatchObject({ host: 'smtp.example.edu', port: 465, secure: true, auth: { user: 'u', pass: 'p' } });
    expect(buildTransportOptions(cfg({ smtp: { host: 'h', port: 587, user: 'u', pass: 'p' } }))).toMatchObject({ secure: false });
  });

  it('uses SendGrid when only an API key is set (the production checks accept that as "mail is configured")', () => {
    const options = buildTransportOptions(cfg({ sendgridApiKey: 'SG.key' }))!;
    expect(options).toMatchObject({ host: 'smtp.sendgrid.net', port: 587, secure: false, auth: { user: 'apikey', pass: 'SG.key' } });
  });

  it('prefers SendGrid over SMTP when both are set', () => {
    const options = buildTransportOptions(cfg({ sendgridApiKey: 'SG.key', smtp: { host: 'h', port: 587, user: 'u', pass: 'p' } }))!;
    expect(options.host).toBe('smtp.sendgrid.net');
  });

  it('never lets a stuck mail server hold a request for minutes: every phase has a short timeout', () => {
    for (const options of [
      buildTransportOptions(cfg({ sendgridApiKey: 'SG.key' }))!,
      buildTransportOptions(cfg({ smtp: { host: 'h', port: 587, user: 'u', pass: 'p' } }))!,
    ]) {
      expect(options.connectionTimeout).toBeLessThanOrEqual(15_000);
      expect(options.greetingTimeout).toBeLessThanOrEqual(15_000);
      expect(options.socketTimeout).toBeLessThanOrEqual(30_000);
    }
  });
});

describe('isTransientMailError', () => {
  it.each([
    ['a refused connection', { code: 'ECONNECTION' }],
    ['a timeout', { code: 'ETIMEDOUT' }],
    ['a reset socket', { code: 'ESOCKET' }],
    ['a DNS failure', { code: 'EDNS' }],
    ['"try again later" (421)', { responseCode: 421 }],
    ['a busy mailbox (450)', { responseCode: 450 }],
    ['local error in processing (451)', { responseCode: 451 }],
  ])('retries %s', (_label, error) => {
    expect(isTransientMailError(error)).toBe(true);
  });

  it.each([
    ['a rejected recipient (550)', { responseCode: 550 }],
    ['an authentication failure', { code: 'EAUTH', responseCode: 535 }],
    ['a message the server refuses (554)', { responseCode: 554 }],
    ['an unknown error', new Error('weird')],
    ['nothing', undefined],
  ])('does not retry %s: trying again cannot help', (_label, error) => {
    expect(isTransientMailError(error)).toBe(false);
  });
});

describe('sendWithRetry', () => {
  const instant = jest.fn().mockResolvedValue(undefined);
  beforeEach(() => instant.mockClear());

  it('returns at once when the first attempt works', async () => {
    const send = jest.fn().mockResolvedValue('sent');
    await expect(sendWithRetry(send, { sleep: instant })).resolves.toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(instant).not.toHaveBeenCalled();
  });

  it('retries a transient failure with a growing pause, then succeeds', async () => {
    const send = jest.fn().mockRejectedValueOnce({ code: 'ETIMEDOUT' }).mockRejectedValueOnce({ responseCode: 451 }).mockResolvedValue('sent');
    await expect(sendWithRetry(send, { sleep: instant, baseDelayMs: 100 })).resolves.toBe('sent');
    expect(send).toHaveBeenCalledTimes(3);
    expect(instant.mock.calls.map((c) => c[0])).toEqual([100, 300]);
  });

  it('gives up after the retries and throws the last error', async () => {
    const failure = { code: 'ECONNECTION', message: 'down' };
    const send = jest.fn().mockRejectedValue(failure);
    await expect(sendWithRetry(send, { sleep: instant, retries: 2 })).rejects.toBe(failure);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a permanent failure', async () => {
    const send = jest.fn().mockRejectedValue({ responseCode: 550, message: 'no such user' });
    await expect(sendWithRetry(send, { sleep: instant })).rejects.toMatchObject({ responseCode: 550 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
