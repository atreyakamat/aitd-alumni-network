/**
 * Minimal structured logger.
 *
 * - Production writes one JSON object per line (what log collectors want); development prints a readable line.
 * - Warnings and errors go to stderr, the rest to stdout.
 * - LOG_LEVEL (debug | info | warn | error) picks the threshold; default info. Under the test runner it is silent
 *   unless LOG_LEVEL is set, so suites stay readable.
 * - Fields whose name looks like a secret (password, token, authorization, cookie, otp, ...) are never written.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|signature|otp|api[-_]?key/i;

const threshold = (): number => {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase() as LogLevel;
  if (configured in ORDER) return ORDER[configured];
  return process.env.NODE_ENV === 'test' ? Number.POSITIVE_INFINITY : ORDER.info;
};

const asJson = () => process.env.NODE_ENV === 'production' || (process.env.LOG_FORMAT || '').toLowerCase() === 'json';

export const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown; statusCode?: unknown };
    return {
      name: error.name,
      message: error.message,
      ...(withCode.code !== undefined ? { code: withCode.code } : {}),
      ...(withCode.statusCode !== undefined ? { statusCode: withCode.statusCode } : {}),
      stack: error.stack,
    };
  }
  if (error && typeof error === 'object') return { ...(error as Record<string, unknown>), message: String((error as { message?: unknown }).message ?? '') };
  return { message: String(error) };
};

const clean = (value: unknown, depth = 0): unknown => {
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return depth > 3 ? '[…]' : value.map((item) => clean(item, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 3) return '[…]';
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, SENSITIVE_KEY.test(key) ? '[redacted]' : clean(inner, depth + 1)])
    );
  }
  return value;
};

const write = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
  if (ORDER[level] < threshold()) return;
  const cleaned = clean(fields) as Record<string, unknown>;
  const sink = ORDER[level] >= ORDER.warn ? console.error : console.log;

  if (asJson()) {
    let line: string;
    try {
      line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...cleaned });
    } catch {
      // circular or otherwise unserialisable fields must never cost the message itself
      line = JSON.stringify({ time: new Date().toISOString(), level, msg: message, logError: 'fields could not be serialised' });
    }
    sink(line);
    return;
  }

  const details = Object.entries(cleaned)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : safeStringify(value)}`)
    .join(' ');
  sink(`${new Date().toISOString().slice(11, 19)} ${level.padEnd(5)} ${message}${details ? ` ${details}` : ''}`);
};

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserialisable]';
  }
};

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
