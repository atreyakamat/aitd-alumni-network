import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { api, getApprovalState } from '@/lib/api';

/**
 * Alumni approval, seen from the API client: an administrator has to approve a registration, and can take the approval
 * back. The real response interceptor runs against a fake transport adapter, like api-refresh.test.ts does.
 */

const reject = (config: InternalAxiosRequestConfig, status: number, code: string, message = 'Not approved') =>
  Promise.reject(
    new AxiosError(status === 403 ? 'Forbidden' : 'Unauthorized', 'ERR_BAD_REQUEST', config, null, {
      status,
      statusText: status === 403 ? 'Forbidden' : 'Unauthorized',
      headers: {},
      config,
      data: { success: false, error: { message, code } },
    })
  );

const answerWith = (status: number, code: string, message?: string) => {
  const adapter = vi.fn((config: InternalAxiosRequestConfig) => reject(config, status, code, message));
  api.defaults.adapter = adapter as unknown as AxiosAdapter;
  return adapter;
};

const navigations: string[] = [];
/** `window.location` as seen by the interceptor; records every assignment to `href`. */
const at = (pathname: string, search = '') =>
  vi.stubGlobal('location', {
    pathname,
    search,
    hash: '',
    protocol: 'http:',
    hostname: 'localhost',
    origin: 'http://localhost',
    get href() {
      return `http://localhost${pathname}${search}`;
    },
    set href(value: string) {
      navigations.push(value);
    },
  });

const listen = (name: string) => {
  const handler = vi.fn();
  window.addEventListener(name, handler);
  return { handler, stop: () => window.removeEventListener(name, handler) };
};

let originalAdapter: unknown;

beforeEach(() => {
  originalAdapter = api.defaults.adapter;
  navigations.length = 0;
  localStorage.setItem('accessToken', 'old-access');
  localStorage.setItem('refreshToken', 'refresh-1');
  document.cookie = 'aiem_session=1; Path=/';
});

afterEach(() => {
  api.defaults.adapter = originalAdapter as any;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = 'aiem_session=; Path=/; Max-Age=0';
});

describe('getApprovalState', () => {
  const err = (status: number, code?: string) => ({ response: { status, data: { success: false, error: { code, message: 'x' } } } });

  it('recognises the two 403 codes the server uses', () => {
    expect(getApprovalState(err(403, 'ACCOUNT_PENDING_APPROVAL'))).toBe('pending');
    expect(getApprovalState(err(403, 'ACCOUNT_REJECTED'))).toBe('rejected');
  });

  it.each([
    [err(403, 'FORBIDDEN')],
    [err(403, 'EMAIL_NOT_VERIFIED')],
    [err(401, 'ACCOUNT_PENDING_APPROVAL')],
    [err(500, 'ACCOUNT_REJECTED')],
    [err(403)],
    [{ response: { status: 403, data: '<html>' } }],
    [{ response: undefined }],
    [new Error('boom')],
    [null],
    [undefined],
  ])('ignores everything else (%#)', (value) => {
    expect(getApprovalState(value)).toBeNull();
  });
});

describe('the account is not (or no longer) approved', () => {
  it.each([
    ['ACCOUNT_PENDING_APPROVAL', 'pending'],
    ['ACCOUNT_REJECTED', 'rejected'],
  ])('%s on a call of a signed-in member ends the session and sends them to /login?approval=%s', async (code, state) => {
    at('/dashboard');
    const refreshSpy = vi.spyOn(axios, 'post');
    answerWith(403, code, 'Server says no');
    const notApproved = listen('api:account_not_approved');
    const expired = listen('api:session_expired');
    const forbidden = listen('api:forbidden');

    await expect(api.get('/posts')).rejects.toMatchObject({ response: { status: 403 } });

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(document.cookie).not.toContain('aiem_session=1');
    expect(notApproved.handler).toHaveBeenCalledTimes(1);
    expect((notApproved.handler.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ state, message: 'Server says no' });
    // it is not an expired session and not an ordinary "you may not do that"
    expect(expired.handler).not.toHaveBeenCalled();
    expect(forbidden.handler).not.toHaveBeenCalled();
    // and the refresh token is not spent on a session that cannot continue
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(navigations).toEqual([`/login?approval=${state}`]);
    notApproved.stop();
    expired.stop();
    forbidden.stop();
  });

  it('on the landing page it only clears the session: a visitor is not bounced to the login page', async () => {
    at('/');
    answerWith(403, 'ACCOUNT_PENDING_APPROVAL');
    const notApproved = listen('api:account_not_approved');

    await expect(api.get('/auth/me')).rejects.toBeTruthy();

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(notApproved.handler).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual([]);
    notApproved.stop();
  });

  it('on /donations (open to visitors for guest donations) it only clears the session too: the page drops to the visitor view', async () => {
    at('/donations');
    answerWith(403, 'ACCOUNT_REJECTED');
    const notApproved = listen('api:account_not_approved');

    await expect(api.get('/donations/wall')).rejects.toBeTruthy();

    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(notApproved.handler).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual([]);
    notApproved.stop();
  });

  it('a visitor donating as a guest is never taken anywhere: a refused order is just an error on the form', async () => {
    localStorage.clear();
    at('/donations');
    const adapter = answerWith(400, 'VALIDATION_ERROR', 'Amount must be at least ₹1');
    const expired = listen('api:session_expired');
    const notApproved = listen('api:account_not_approved');

    await expect(api.post('/donations/order', { amount: 0 })).rejects.toMatchObject({ response: { status: 400 } });

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(expired.handler).not.toHaveBeenCalled();
    expect(notApproved.handler).not.toHaveBeenCalled();
    expect(navigations).toEqual([]);
    expired.stop();
    notApproved.stop();
  });

  it('a burst of calls announces it once and navigates once', async () => {
    at('/jobs');
    answerWith(403, 'ACCOUNT_REJECTED');
    const notApproved = listen('api:account_not_approved');

    await Promise.allSettled([api.get('/posts'), api.get('/events'), api.get('/jobs')]);

    expect(notApproved.handler).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual(['/login?approval=rejected']);
    notApproved.stop();
  });

  it.each(['/auth/login', '/auth/verify-2fa'])(
    'the sign-in call POST %s is left to the login page: no redirect, no event, tokens of an older session untouched',
    async (url) => {
      at('/login');
      answerWith(403, 'ACCOUNT_PENDING_APPROVAL');
      const notApproved = listen('api:account_not_approved');
      const forbidden = listen('api:forbidden');

      await expect(api.post(url, {})).rejects.toMatchObject({
        response: { status: 403, data: { error: { code: 'ACCOUNT_PENDING_APPROVAL' } } },
      });

      expect(notApproved.handler).not.toHaveBeenCalled();
      expect(forbidden.handler).not.toHaveBeenCalled();
      expect(navigations).toEqual([]);
      expect(localStorage.getItem('refreshToken')).toBe('refresh-1');
      notApproved.stop();
      forbidden.stop();
    }
  );

  it('an ordinary 403 (no permission) keeps the session and still says so', async () => {
    at('/admin/users');
    answerWith(403, 'FORBIDDEN', 'Insufficient permissions');
    const notApproved = listen('api:account_not_approved');
    const forbidden = listen('api:forbidden');

    await expect(api.get('/admin/users')).rejects.toBeTruthy();

    expect(localStorage.getItem('accessToken')).toBe('old-access');
    expect(notApproved.handler).not.toHaveBeenCalled();
    expect(forbidden.handler).toHaveBeenCalledTimes(1);
    expect(navigations).toEqual([]);
    notApproved.stop();
    forbidden.stop();
  });

  it('a refresh that the server answers with ACCOUNT_REJECTED is reported as such, not as an expired session', async () => {
    at('/dashboard');
    answerWith(401, 'TOKEN_EXPIRED');
    vi.spyOn(axios, 'post').mockRejectedValue(
      new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, null, {
        status: 403,
        statusText: 'Forbidden',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
        data: { success: false, error: { message: 'Not approved', code: 'ACCOUNT_REJECTED' } },
      })
    );
    const notApproved = listen('api:account_not_approved');
    const expired = listen('api:session_expired');

    await expect(api.get('/posts')).rejects.toBeTruthy();

    expect(notApproved.handler).toHaveBeenCalledTimes(1);
    expect((notApproved.handler.mock.calls[0][0] as CustomEvent).detail).toMatchObject({ state: 'rejected' });
    expect(expired.handler).not.toHaveBeenCalled();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(navigations).toEqual(['/login?approval=rejected']);
    notApproved.stop();
    expired.stop();
  });
});

describe('an expired session and the pages that are open to visitors', () => {
  const failRefresh = () => {
    answerWith(401, 'TOKEN_EXPIRED');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh token reused'));
  };

  it.each(['/', '/login', '/register', '/privacy', '/contact', '/donations', '/donations/thanks'])(
    'does not bounce %s to the login page: it is open to visitors anyway',
    async (pathname) => {
      at(pathname);
      failRefresh();
      const expired = listen('api:session_expired');

      await expect(api.get('/auth/me')).rejects.toBeTruthy();

      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(expired.handler).toHaveBeenCalledTimes(1);
      expect(navigations).toEqual([]);
      expired.stop();
    }
  );

  it.each([
    ['/events', '', '/login?next=%2Fevents'],
    ['/posts/123', '', '/login?next=%2Fposts%2F123'],
    ['/search', '?q=x', '/login?next=%2Fsearch%3Fq%3Dx'],
    ['/dashboard', '', '/login?next=%2Fdashboard'],
  ])(
    'sends %s%s to the login page, which brings the member back afterwards (only /donations is public: see above)',
    async (pathname, search, expected) => {
      at(pathname, search);
      failRefresh();

      await expect(api.get('/posts')).rejects.toBeTruthy();

      expect(navigations).toEqual([expected]);
    }
  );
});
