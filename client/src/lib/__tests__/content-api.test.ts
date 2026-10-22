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

import { chapterApi, newsApi } from '@/lib/api';

beforeEach(() => {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    mockInstance[method].mockReset();
    mockInstance[method].mockResolvedValue({ data: { success: true, data: {} } });
  }
});

describe('chapterApi (chapters pages)', () => {
  it('lists, joins and leaves chapters', async () => {
    await chapterApi.getChapters(1, 100);
    expect(mockInstance.get).toHaveBeenCalledWith('/chapters', { params: { page: 1, limit: 100 } });
    await chapterApi.getChapters(2, 24, { search: 'pune', region: '' });
    expect(mockInstance.get).toHaveBeenLastCalledWith('/chapters', { params: { page: 2, limit: 24, search: 'pune' } });
    await chapterApi.getChapters(1, 24, { region: 'West India' });
    expect(mockInstance.get).toHaveBeenLastCalledWith('/chapters', { params: { page: 1, limit: 24, region: 'West India' } });
    await chapterApi.joinChapter('c1');
    expect(mockInstance.post).toHaveBeenCalledWith('/chapters/c1/join');
    await chapterApi.leaveChapter('c1');
    expect(mockInstance.post).toHaveBeenLastCalledWith('/chapters/c1/leave');
  });

  it('creates a chapter via POST /chapters', async () => {
    await chapterApi.createChapter({ name: 'Pune', region: 'West India' });
    expect(mockInstance.post).toHaveBeenCalledWith('/chapters', { name: 'Pune', region: 'West India' });
  });

  it('encodes ids in chapter paths', async () => {
    await chapterApi.getChapter('a/b');
    expect(mockInstance.get).toHaveBeenCalledWith('/chapters/a%2Fb');
    await chapterApi.getMembers('a/b', 2, 20);
    expect(mockInstance.get).toHaveBeenLastCalledWith('/chapters/a%2Fb/members', { params: { page: 2, limit: 20 } });
  });
});

describe('newsApi', () => {
  it('drops empty filters from the list query', async () => {
    await newsApi.getArticles({ page: 1, limit: 12, category: undefined });
    expect(mockInstance.get).toHaveBeenCalledWith('/news', { params: { page: 1, limit: 12 } });
    await newsApi.getArticles({ page: 2, limit: 12, category: 'NEWSLETTER' });
    expect(mockInstance.get).toHaveBeenLastCalledWith('/news', { params: { page: 2, limit: 12, category: 'NEWSLETTER' } });
    await newsApi.getArticles({ page: 1, limit: 12, search: 'reunion' });
    expect(mockInstance.get).toHaveBeenLastCalledWith('/news', { params: { page: 1, limit: 12, search: 'reunion' } });
  });

  it('encodes the slug', async () => {
    await newsApi.getArticle('hello world');
    expect(mockInstance.get).toHaveBeenCalledWith('/news/hello%20world');
  });
});
