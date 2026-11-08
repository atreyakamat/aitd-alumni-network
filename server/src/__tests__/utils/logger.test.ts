import { log, serializeError } from '../../utils/logger';

describe('logger', () => {
  const saved = { ...process.env };
  let out: jest.SpyInstance;
  let err: jest.SpyInstance;

  beforeEach(() => {
    out = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_FORMAT;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...saved };
  });

  it('is silent under the test runner unless a level is asked for, so suites stay readable', () => {
    process.env.NODE_ENV = 'test';
    log.error('boom');
    log.info('hello');
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it('writes one JSON object per line in production, errors and warnings to stderr', () => {
    process.env.NODE_ENV = 'production';
    log.info('started', { port: 5000 });
    log.error('failed', { id: 'abc' });

    const info = JSON.parse(out.mock.calls[0][0]);
    expect(info).toMatchObject({ level: 'info', msg: 'started', port: 5000 });
    expect(typeof info.time).toBe('string');
    expect(JSON.parse(err.mock.calls[0][0])).toMatchObject({ level: 'error', msg: 'failed', id: 'abc' });
  });

  it('honours LOG_LEVEL', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'warn';
    log.info('quiet');
    log.debug('quieter');
    log.warn('loud');
    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);

    process.env.LOG_LEVEL = 'debug';
    log.debug('now visible');
    expect(out).toHaveBeenCalledTimes(1);
  });

  it('prints a readable line outside production', () => {
    process.env.NODE_ENV = 'development';
    log.info('ready', { port: 5000 });
    const line = out.mock.calls[0][0] as string;
    expect(line).toContain('info');
    expect(line).toContain('ready');
    expect(line).toContain('port=5000');
  });

  it('never writes secrets, however the field is nested', () => {
    process.env.NODE_ENV = 'production';
    log.info('login', {
      email: 'a@b.io',
      password: 'hunter2',
      refreshToken: 'rt',
      headers: { authorization: 'Bearer abc', cookie: 'x=1', accept: 'json' },
      otp: '123456',
    });
    const line = out.mock.calls[0][0] as string;
    for (const secret of ['hunter2', '"rt"', 'Bearer abc', 'x=1', '123456']) expect(line).not.toContain(secret);
    expect(JSON.parse(line)).toMatchObject({ email: 'a@b.io', password: '[redacted]', headers: { accept: 'json', authorization: '[redacted]' } });
  });

  it('serialises errors with their stack, and survives values that cannot be stringified', () => {
    process.env.NODE_ENV = 'production';
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    log.error('bad', { err: Object.assign(new Error('nope'), { code: 'E_CODE' }), circular });
    const written = JSON.parse(err.mock.calls[0][0]);
    expect(written.err).toMatchObject({ name: 'Error', message: 'nope', code: 'E_CODE' });
    expect(written.err.stack).toContain('nope');
  });

  it('serializeError copes with non-errors', () => {
    expect(serializeError('text')).toEqual({ message: 'text' });
    expect(serializeError(undefined)).toEqual({ message: 'undefined' });
    expect(serializeError({ message: 'obj' })).toMatchObject({ message: 'obj' });
  });
});
