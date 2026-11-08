import { describe, expect, it } from 'vitest';
import { api, getApiErrorMessage, REQUEST_TIMEOUT_MS } from '@/lib/api';
import { createQueryClient, retryDelay, shouldRetryQuery } from '@/lib/query-client';

/** Lets a request run through the real interceptors, and returns the config it ended up with. */
const configSeenByTheNetwork = async (call: () => Promise<unknown>) => {
  let seen: { timeout?: number } | undefined;
  const original = api.defaults.adapter;
  api.defaults.adapter = async (config) => {
    seen = config;
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    await call();
  } finally {
    api.defaults.adapter = original;
  }
  return seen!;
};

describe('request timeout', () => {
  it('gives ordinary requests a limit, so a hung server cannot leave a spinner forever', async () => {
    expect(REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    const config = await configSeenByTheNetwork(() => api.get('/events'));
    expect(config.timeout).toBe(REQUEST_TIMEOUT_MS);
  });

  it('does not limit file uploads: a 100 MB video on a slow connection takes minutes', async () => {
    const form = new FormData();
    form.append('video', new Blob(['x']), 'a.mp4');
    const config = await configSeenByTheNetwork(() => api.post('/videos/upload', form));
    expect(config.timeout).toBe(0);
  });
});

describe('error messages people can act on', () => {
  it('a timeout says the server was slow, not "timeout of 30000ms exceeded"', () => {
    const error = Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' });
    expect(getApiErrorMessage(error, 'Could not load')).toMatch(/took too long/i);
  });

  it('a network failure says the server cannot be reached, not "Network Error"', () => {
    const error = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    expect(getApiErrorMessage(error, 'Could not load')).toMatch(/connection|reach/i);
  });

  it('still prefers the message the server sent', () => {
    const error = { response: { status: 400, data: { success: false, error: { message: 'Title is required', code: 'VALIDATION_ERROR' } } } };
    expect(getApiErrorMessage(error, 'Could not save')).toBe('Title is required');
  });

  it('falls back for anything else', () => {
    expect(getApiErrorMessage({ response: { status: 500, data: '<html>' } }, 'Could not save')).toBe('Could not save');
  });
});

describe('when a failed query is tried again', () => {
  const failure = (status?: number, code?: string) => ({ response: status ? { status } : undefined, code });

  it.each([
    ['network failure', failure(undefined, 'ERR_NETWORK')],
    ['timeout', failure(undefined, 'ECONNABORTED')],
    ['500', failure(500)],
    ['502', failure(502)],
    ['503', failure(503)],
    ['504', failure(504)],
    ['408', failure(408)],
    ['429', failure(429)],
  ])('retries a %s (it may well work a moment later)', (_label, error) => {
    expect(shouldRetryQuery(0, error)).toBe(true);
    expect(shouldRetryQuery(1, error)).toBe(true);
  });

  it('gives up after two retries', () => {
    expect(shouldRetryQuery(2, failure(503))).toBe(false);
  });

  it.each([400, 401, 403, 404, 409, 422])('does not retry a %s: asking again gets the same answer', (status) => {
    expect(shouldRetryQuery(0, failure(status))).toBe(false);
  });

  it('waits longer each time, with a ceiling', () => {
    expect(retryDelay(0)).toBeLessThan(retryDelay(1));
    expect(retryDelay(1)).toBeLessThan(retryDelay(2));
    expect(retryDelay(20)).toBeLessThanOrEqual(10_000);
  });

  it('the app-wide query client uses these rules', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions().queries!;
    expect(defaults.retry).toBe(shouldRetryQuery);
    expect(defaults.retryDelay).toBe(retryDelay);
    expect(defaults.refetchOnWindowFocus).toBe(false);
  });
});
