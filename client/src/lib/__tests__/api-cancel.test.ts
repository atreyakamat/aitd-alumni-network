import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, CanceledError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api } from '@/lib/api';

/**
 * A request that the page itself cancelled (the person switched tabs, typed another letter, left the page) is not a
 * failure. Reporting it as "Cannot reach the server" told people their connection was down when nothing was wrong.
 */

let originalAdapter: unknown;
let networkEvents: CustomEvent[];
const onNetwork = (event: Event) => networkEvents.push(event as CustomEvent);

beforeEach(() => {
  originalAdapter = api.defaults.adapter;
  networkEvents = [];
  window.addEventListener('api:network_error', onNetwork);
});

afterEach(() => {
  window.removeEventListener('api:network_error', onNetwork);
  api.defaults.adapter = originalAdapter as AxiosAdapter;
  vi.restoreAllMocks();
});

describe('cancelled requests', () => {
  it('are passed on as cancellations, with no "network error" event and no console error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.defaults.adapter = (async () => {
      throw new CanceledError('canceled');
    }) as unknown as AxiosAdapter;

    const outcome = await api.get('/feed').then(
      () => null,
      (error) => error
    );

    expect(axios.isCancel(outcome)).toBe(true);
    expect(networkEvents).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('are recognised when the page aborts through an AbortController', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = new AbortController();
    api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      // what the browser adapter does when the signal fires: the request fails with ERR_CANCELED, without a response
      throw new AxiosError('canceled', AxiosError.ERR_CANCELED, config);
    }) as unknown as AxiosAdapter;

    const outcome = await api.get('/search', { signal: controller.signal }).then(
      () => null,
      (error) => error
    );

    expect(outcome).toBeInstanceOf(AxiosError);
    expect(networkEvents).toHaveLength(0);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe('a real connection failure', () => {
  it('is still announced once, so people are told the server cannot be reached', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    api.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
    }) as unknown as AxiosAdapter;

    await api.get('/events').catch(() => null);

    expect(networkEvents).toHaveLength(1);
    expect(consoleError).toHaveBeenCalled();
  });
});
