import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockInstance = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  defaults: { baseURL: '' },
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
}));

vi.mock('axios', () => {
  const create = vi.fn(() => mockInstance);
  return { default: { create, post: vi.fn() }, create };
});

import {
  accountApi,
  adminApi,
  chapterApi,
  eventApi,
  getApiErrorMessage,
  jobApi,
  searchApi,
  transactionApi,
  EXPORT_ENTITIES,
} from '@/lib/api';

const ok = (data: unknown = {}) => Promise.resolve({ data: { success: true, data } });

beforeEach(() => {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    mockInstance[method].mockReset();
    mockInstance[method].mockImplementation(() => ok());
  }
});

describe('searchApi', () => {
  it('GET /search with q param', async () => {
    await searchApi.globalSearch('ada');
    expect(mockInstance.get).toHaveBeenCalledWith('/search', { params: { q: 'ada' } });
  });
});

describe('adminApi', () => {
  it('lists users with filters', async () => {
    await adminApi.listUsers({ search: 'ada', role: 'ADMIN', isActive: true, batchYear: 2020, page: 2, limit: 20 });
    expect(mockInstance.get).toHaveBeenCalledWith('/admin/users', {
      params: { search: 'ada', role: 'ADMIN', isActive: true, batchYear: 2020, page: 2, limit: 20 },
    });
  });

  it('drops empty filters so the server sees no blank params', async () => {
    await adminApi.listUsers({ search: '', role: undefined, page: 1 });
    expect(mockInstance.get).toHaveBeenCalledWith('/admin/users', { params: { page: 1 } });
  });

  it('PATCHes a user role', async () => {
    await adminApi.updateUserRole('u1', 'CHAPTER_ADMIN');
    expect(mockInstance.patch).toHaveBeenCalledWith('/admin/users/u1/role', { role: 'CHAPTER_ADMIN' });
  });

  it('PATCHes a user status with an optional reason', async () => {
    await adminApi.updateUserStatus('u1', false, 'spam');
    expect(mockInstance.patch).toHaveBeenCalledWith('/admin/users/u1/status', { isActive: false, reason: 'spam' });
    await adminApi.updateUserStatus('u2', true);
    expect(mockInstance.patch).toHaveBeenLastCalledWith('/admin/users/u2/status', { isActive: true });
  });

  it('GETs the pending job queue', async () => {
    await adminApi.getPendingJobs({ page: 3, limit: 10 });
    expect(mockInstance.get).toHaveBeenCalledWith('/admin/jobs/pending', { params: { page: 3, limit: 10 } });
  });

  it('GETs the mentorship overview', async () => {
    await adminApi.getMentorshipOverview();
    expect(mockInstance.get).toHaveBeenCalledWith('/admin/mentorship/overview');
  });

  it('downloads CSV exports as blobs for every entity', async () => {
    expect(EXPORT_ENTITIES).toEqual(['users', 'transactions', 'donations', 'jobs', 'events']);
    for (const entity of EXPORT_ENTITIES) {
      await adminApi.exportEntity(entity);
      expect(mockInstance.get).toHaveBeenLastCalledWith(`/admin/export/${entity}`, { responseType: 'blob' });
    }
  });

  it('url-encodes ids', async () => {
    await adminApi.updateUserRole('a/b', 'MEMBER');
    expect(mockInstance.patch).toHaveBeenCalledWith('/admin/users/a%2Fb/role', { role: 'MEMBER' });
  });
});

describe('jobApi moderation', () => {
  it('approves and rejects with a reason', async () => {
    await jobApi.approveJob('j1');
    expect(mockInstance.post).toHaveBeenCalledWith('/jobs/j1/approve');
    await jobApi.rejectJob('j1', 'Spam');
    expect(mockInstance.post).toHaveBeenLastCalledWith('/jobs/j1/reject', { reason: 'Spam' });
  });
});

describe('chapterApi', () => {
  it('assigns a chapter admin via PUT', async () => {
    await chapterApi.assignAdmin('c1', 'u1');
    expect(mockInstance.put).toHaveBeenCalledWith('/chapters/c1/admin', { userId: 'u1' });
  });

  it('PATCHes a chapter', async () => {
    await chapterApi.updateChapter('c1', { description: 'x' });
    expect(mockInstance.patch).toHaveBeenCalledWith('/chapters/c1', { description: 'x' });
  });
});

describe('eventApi', () => {
  it('POSTs a new event including chapterId', async () => {
    const payload = { title: 'Meetup', description: 'd', startDate: '2026-01-01T10:00:00.000Z', chapterId: 'c1' };
    await eventApi.createEvent(payload);
    expect(mockInstance.post).toHaveBeenCalledWith('/events', payload);
  });
});

describe('accountApi', () => {
  it('GETs my data export', async () => {
    await accountApi.exportMyData();
    expect(mockInstance.get).toHaveBeenCalledWith('/users/me/export');
  });

  it('DELETEs my account with a password body', async () => {
    await accountApi.deleteMyAccount({ password: 'secret' });
    expect(mockInstance.delete).toHaveBeenCalledWith('/users/me', { data: { password: 'secret' } });
  });

  it('DELETEs my account with a typed confirmation for OAuth accounts', async () => {
    await accountApi.deleteMyAccount({ confirm: 'DELETE' });
    expect(mockInstance.delete).toHaveBeenCalledWith('/users/me', { data: { confirm: 'DELETE' } });
  });
});

describe('transactionApi', () => {
  it('lists my transactions with filters', async () => {
    await transactionApi.getMyTransactions({ type: 'DONATION', page: 2, limit: 10 });
    expect(mockInstance.get).toHaveBeenCalledWith('/transactions/my', {
      params: { type: 'DONATION', page: 2, limit: 10 },
    });
  });

  it('downloads a receipt as a blob', async () => {
    await transactionApi.downloadReceipt('t1');
    expect(mockInstance.get).toHaveBeenCalledWith('/transactions/t1/receipt', { responseType: 'blob' });
  });
});

describe('getApiErrorMessage', () => {
  it('reads the structured server error shape', () => {
    const err = { response: { data: { success: false, error: { message: 'Nope', code: 'FORBIDDEN' } } } };
    expect(getApiErrorMessage(err, 'fallback')).toBe('Nope');
  });

  it('reads legacy string errors and top-level messages', () => {
    expect(getApiErrorMessage({ response: { data: { error: 'Legacy' } } }, 'f')).toBe('Legacy');
    expect(getApiErrorMessage({ response: { data: { message: 'Top' } } }, 'f')).toBe('Top');
  });

  it('falls back when nothing useful is available', () => {
    expect(getApiErrorMessage(undefined, 'fallback')).toBe('fallback');
    expect(getApiErrorMessage({ response: { data: { error: {} } } }, 'fallback')).toBe('fallback');
    expect(getApiErrorMessage(new Error(''), 'fallback')).toBe('fallback');
  });

  it('uses Error.message for non-HTTP errors', () => {
    expect(getApiErrorMessage(new Error('Network Error'), 'fallback')).toBe('Network Error');
  });
});

describe('getApiErrorMessageAsync', () => {
  it('parses JSON error bodies returned as Blobs (blob downloads)', async () => {
    const { getApiErrorMessageAsync } = await import('@/lib/api');
    const blob = new Blob([JSON.stringify({ success: false, error: { message: 'Invalid entity', code: 'BAD' } })], {
      type: 'application/json',
    });
    await expect(getApiErrorMessageAsync({ response: { data: blob } }, 'f')).resolves.toBe('Invalid entity');
  });

  it('falls back for unparseable blobs', async () => {
    const { getApiErrorMessageAsync } = await import('@/lib/api');
    const blob = new Blob(['<html>'], { type: 'text/html' });
    await expect(getApiErrorMessageAsync({ response: { data: blob } }, 'fallback')).resolves.toBe('fallback');
  });
});
