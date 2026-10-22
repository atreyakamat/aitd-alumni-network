import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '' },
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));

vi.mock('axios', () => {
  const create = vi.fn(() => mockInstance);
  return { default: { create, post: vi.fn() }, create };
});

import { getApiFieldErrors, isTwoFactorChallenge, shouldAttemptRefresh, twoFactorApi } from '@/lib/api';
import { getAuthErrorMessage, passwordSchema, shouldRestart2FA } from '@/lib/auth';

const apiError = (code: string, message = 'server message', status = 400, details?: unknown) => ({
  response: { status, data: { success: false, error: { code, message, details } } },
});

beforeEach(() => {
  mockInstance.post.mockReset();
  mockInstance.post.mockResolvedValue({ data: { success: true, data: {} } });
});

describe('passwordSchema (server policy: 8-128, upper, lower, digit)', () => {
  it.each([
    ['Abcdefg1', true],
    ['abcdefg1', false],
    ['ABCDEFG1', false],
    ['Abcdefgh', false],
    ['Abc1', false],
    ['A1' + 'a'.repeat(126), true],
    ['A1' + 'a'.repeat(127), false],
  ])('%s -> %s', (pw, ok) => {
    expect(passwordSchema.safeParse(pw).success).toBe(ok);
  });
});

describe('2FA API contract', () => {
  it('verify sends {twoFactorToken, otp} (no userId)', async () => {
    await twoFactorApi.verify2FA('tok', '123456');
    expect(mockInstance.post).toHaveBeenCalledWith('/auth/verify-2fa', { twoFactorToken: 'tok', otp: '123456' });
  });

  it('resend sends {twoFactorToken} only', async () => {
    await twoFactorApi.resend2FA('tok');
    expect(mockInstance.post).toHaveBeenCalledWith('/auth/resend-2fa', { twoFactorToken: 'tok' });
  });

  it('recognizes a login 2FA challenge', () => {
    expect(isTwoFactorChallenge({ requires2FA: true, userId: 'u', twoFactorToken: 't' })).toBe(true);
    expect(isTwoFactorChallenge({ requires2FA: true, userId: 'u' })).toBe(false);
    expect(isTwoFactorChallenge({ accessToken: 'a', refreshToken: 'r', user: {} })).toBe(false);
  });
});

describe('getAuthErrorMessage / shouldRestart2FA', () => {
  it('maps OTP error codes to friendly messages', () => {
    expect(getAuthErrorMessage(apiError('INVALID_OTP'), 'f')).toMatch(/invalid or has expired/i);
    expect(getAuthErrorMessage(apiError('OTP_ATTEMPTS_EXCEEDED', 'x', 429), 'f')).toMatch(/too many/i);
    expect(getAuthErrorMessage(apiError('OTP_RESEND_TOO_SOON', 'x', 429), 'f')).toMatch(/wait/i);
    expect(getAuthErrorMessage(apiError('INVALID_2FA_SESSION', 'x', 401), 'f')).toMatch(/sign in again/i);
  });

  it('falls back to the server message, then the fallback', () => {
    expect(getAuthErrorMessage(apiError('SOMETHING', 'Nope'), 'f')).toBe('Nope');
    expect(getAuthErrorMessage({ response: { data: { error: 'Legacy string' } } }, 'f')).toBe('Legacy string');
    expect(getAuthErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('restarts the challenge only for expired sessions / exhausted attempts', () => {
    expect(shouldRestart2FA(apiError('INVALID_2FA_SESSION'))).toBe(true);
    expect(shouldRestart2FA(apiError('OTP_ATTEMPTS_EXCEEDED'))).toBe(true);
    expect(shouldRestart2FA(apiError('INVALID_OTP'))).toBe(false);
  });
});

describe('getApiFieldErrors', () => {
  it('maps VALIDATION_ERROR details to form fields', () => {
    const err = apiError('VALIDATION_ERROR', 'Validation failed', 400, [
      { field: 'body.password', message: 'Too weak' },
      { field: 'body.password', message: 'second message ignored' },
      { field: 'email', message: 'Bad email' },
      { message: 'no field' },
    ]);
    expect(getApiFieldErrors(err)).toEqual({ password: 'Too weak', email: 'Bad email' });
  });

  it('returns {} without details', () => {
    expect(getApiFieldErrors(apiError('X'))).toEqual({});
    expect(getApiFieldErrors(undefined)).toEqual({});
  });
});

describe('shouldAttemptRefresh', () => {
  it('skips credential endpoints and credential error codes', () => {
    expect(shouldAttemptRefresh('/auth/login', {})).toBe(false);
    expect(shouldAttemptRefresh('/auth/verify-2fa', {})).toBe(false);
    expect(shouldAttemptRefresh('/users/me', { error: { code: 'INVALID_PASSWORD' } })).toBe(false);
    expect(shouldAttemptRefresh('/users/me', { error: { code: 'TOKEN_EXPIRED' } })).toBe(true);
    expect(shouldAttemptRefresh('/posts', undefined)).toBe(true);
  });
});
