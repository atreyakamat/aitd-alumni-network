import type { Request, Response } from 'express';
import config from '../../config';
import { issueOAuthState, OAUTH_STATE_COOKIE, verifyOAuthState } from '../../middleware/oauthState';

const fakeRes = () =>
  ({ cookie: jest.fn(), clearCookie: jest.fn(), redirect: jest.fn() }) as unknown as Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
    redirect: jest.Mock;
  };

const fakeReq = (cookie: string | undefined, state?: unknown) =>
  ({ headers: cookie === undefined ? {} : { cookie }, query: state === undefined ? {} : { state } }) as unknown as Request;

describe('middleware/oauthState (AU-02)', () => {
  it('issues an unguessable state pinned to the browser in an HttpOnly, SameSite=Lax cookie', () => {
    const res = fakeRes();
    const a = issueOAuthState(res);
    const b = issueOAuthState(fakeRes());

    expect(a).toMatch(/^[a-f0-9]{48}$/);
    expect(a).not.toBe(b);
    expect(res.cookie).toHaveBeenCalledWith(
      OAUTH_STATE_COOKIE,
      a,
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/api/auth', maxAge: 10 * 60 * 1000 })
    );
  });

  it('lets the callback through only when the echoed state equals the cookie, and burns the cookie', () => {
    const res = fakeRes();
    const next = jest.fn();
    verifyOAuthState(fakeReq(`a=1; ${OAUTH_STATE_COOKIE}=abc123; b=2`, 'abc123'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith(OAUTH_STATE_COOKIE, expect.objectContaining({ path: '/api/auth' }));
  });

  it.each([
    ['no cookie (login CSRF: the victim never started this flow)', undefined, 'abc123'],
    ['no state echoed by the provider', `${OAUTH_STATE_COOKIE}=abc123`, undefined],
    ['mismatching state', `${OAUTH_STATE_COOKIE}=abc123`, 'zzz999'],
    ['state of different length', `${OAUTH_STATE_COOKIE}=abc123`, 'abc1234'],
    ['empty cookie value', `${OAUTH_STATE_COOKIE}=`, ''],
    ['state given as an array', `${OAUTH_STATE_COOKIE}=abc123`, ['abc123', 'abc123']],
    ['unrelated cookie only', 'session=abc123', 'abc123'],
  ])('redirects to the login error page: %s', (_label, cookie, state) => {
    const res = fakeRes();
    const next = jest.fn();
    verifyOAuthState(fakeReq(cookie, state), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(`${config.frontendUrl}/login?error=oauth_failed`);
  });
});
