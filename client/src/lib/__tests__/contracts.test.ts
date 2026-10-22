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
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { geoApi, jobApi, readPaginated, userApi } from '@/lib/api';
import { jobCreatedMessage } from '@/components/jobs/PostJobDialog';
import { describeTransaction } from '@/components/settings/PaymentHistory';

beforeEach(() => {
  mockInstance.get.mockReset();
  mockInstance.post.mockReset();
  mockInstance.get.mockResolvedValue({ data: { success: true, data: [] } });
  mockInstance.post.mockResolvedValue({ data: { success: true, data: {} } });
});

describe('readPaginated', () => {
  it('reads the current {data, pagination} shape', () => {
    expect(
      readPaginated({ success: true, data: [1, 2], pagination: { total: 12, page: 2, limit: 2, totalPages: 6 } })
    ).toEqual({ items: [1, 2], total: 12, page: 2, totalPages: 6 });
  });

  it('accepts the legacy {items, total, pages} shape and bare arrays', () => {
    expect(readPaginated({ items: ['a'], total: 1, pages: 1, page: 1 })).toEqual({
      items: ['a'],
      total: 1,
      page: 1,
      totalPages: 1,
    });
    expect(readPaginated(['x', 'y'])).toMatchObject({ items: ['x', 'y'], total: 2 });
  });

  it('is safe on empty / undefined bodies', () => {
    expect(readPaginated(undefined)).toEqual({ items: [], total: 0, page: 1, totalPages: 0 });
  });
});

describe('jobs contract', () => {
  it('sends jobType/workplaceType filters', async () => {
    await jobApi.getJobs({ jobType: 'INTERNSHIP', workplaceType: 'REMOTE', page: 1 });
    expect(mockInstance.get).toHaveBeenCalledWith('/jobs', {
      params: { jobType: 'INTERNSHIP', workplaceType: 'REMOTE', page: 1 },
    });
  });

  it('POSTs the createJob schema fields', async () => {
    const job = { title: 'SWE', company: 'Acme', description: 'Build', jobType: 'FULL_TIME' as const, skills: ['TS'] };
    await jobApi.createJob(job);
    expect(mockInstance.post).toHaveBeenCalledWith('/jobs', job);
  });

  it('tells members their job is pending review and admins it is live', () => {
    expect(jobCreatedMessage('PENDING_REVIEW').title).toMatch(/submitted for review/i);
    expect(jobCreatedMessage(undefined).title).toMatch(/submitted for review/i);
    expect(jobCreatedMessage('PUBLISHED').title).toMatch(/published/i);
  });
});

describe('nearby contract', () => {
  it('clamps radius to 500 km and limit to 200', async () => {
    await userApi.getNearby(18.5, 73.8, 2000, 1000);
    expect(mockInstance.get).toHaveBeenCalledWith('/users/nearby', {
      params: { lat: 18.5, lng: 73.8, radius: 500, limit: 200 },
    });
  });

  it('omits unspecified radius/limit', async () => {
    await userApi.getNearby(1, 2);
    expect(mockInstance.get).toHaveBeenCalledWith('/users/nearby', { params: { lat: 1, lng: 2 } });
  });

  it('passes map filters and an abort signal', async () => {
    const controller = new AbortController();
    await userApi.getNearby(1, 2, 25, 50, { filters: { batchYear: 2015, department: 'Civil' }, signal: controller.signal });
    expect(mockInstance.get).toHaveBeenCalledWith('/users/nearby', {
      params: { lat: 1, lng: 2, radius: 25, limit: 50, batchYear: 2015, department: 'Civil' },
      signal: controller.signal,
    });
  });

  it('sends viewport bounds and filters to /users/locations, dropping blanks', async () => {
    await userApi.getLocations({ north: 20, south: 10, east: -170, west: 170, limit: 1000, search: '', batchYear: 2015 });
    expect(mockInstance.get).toHaveBeenCalledWith('/users/locations', {
      params: { north: 20, south: 10, east: -170, west: 170, limit: 1000, batchYear: 2015 },
    });
  });
});

describe('geocoding contract', () => {
  it('searches places and reverse-geocodes coordinates', async () => {
    await geoApi.search('Panaji');
    expect(mockInstance.get).toHaveBeenCalledWith('/geo/search', { params: { q: 'Panaji', limit: 5 } });
    await geoApi.reverse(15.49, 73.83);
    expect(mockInstance.get).toHaveBeenCalledWith('/geo/reverse', { params: { lat: 15.49, lng: 73.83 } });
  });
});

describe('describeTransaction', () => {
  const base = { id: 't', amount: 100, currency: 'INR', status: 'SUCCESS', createdAt: '2026-01-01', receiptAvailable: true };
  it('names memberships by tier and donations by chapter', () => {
    expect(describeTransaction({ ...base, type: 'MEMBERSHIP', memberships: [{ tier: { name: 'Gold' } }] })).toBe(
      'Gold membership'
    );
    expect(describeTransaction({ ...base, type: 'DONATION', donations: [{ chapter: { name: 'Pune' } }] })).toBe(
      'Donation to Pune'
    );
    expect(describeTransaction({ ...base, type: 'DONATION', donations: [] })).toBe('Donation');
  });
});
