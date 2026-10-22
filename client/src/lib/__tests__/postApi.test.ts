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

import { postApi } from '@/lib/api';

beforeEach(() => {
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    mockInstance[method].mockReset();
    mockInstance[method].mockResolvedValue({ data: { success: true, data: {} } });
  }
});

describe('postApi comments', () => {
  it('PATCHes /comments/:id with only the content', async () => {
    await postApi.updateComment('c1', 'new words');
    expect(mockInstance.patch).toHaveBeenCalledWith('/comments/c1', { content: 'new words' });
  });

  it('POSTs a new comment to the post', async () => {
    await postApi.addComment('p1', 'hello');
    expect(mockInstance.post).toHaveBeenCalledWith('/posts/p1/comments', { content: 'hello', parentId: undefined });
  });
});
