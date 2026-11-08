import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { magazineApi, videosApi } from '@/lib/videos';
import { referralsApi, requirementsApi } from '@/lib/engagement';

/** What the API really sends for a list: the controller wraps the service result in { success, data }, and the service
 *  result is { data: [...rows], pagination } - so the rows sit one level deeper than on most other endpoints. */
const serverList = (rows: unknown[], pagination = { total: rows.length, page: 1, limit: 12, totalPages: 1 }) => ({
  data: { success: true, data: { data: rows, pagination } },
});

beforeEach(() => get.mockReset());

describe('list endpoints of the college features return { items, total, page, totalPages }', () => {
  it.each([
    ['videos', () => videosApi.list(), '/videos'],
    ['my videos', () => videosApi.mine(), '/videos/mine'],
    ['magazine', () => magazineApi.list(), '/magazine'],
    ['requirements', () => requirementsApi.list(), '/requirements'],
    ['referrals received', () => referralsApi.received(), '/referrals/received'],
    ['referrals sent', () => referralsApi.sent(), '/referrals/sent'],
  ])('%s: the rows the server sends reach the page', async (_label, call, path) => {
    get.mockResolvedValue(serverList([{ id: 'a' }, { id: 'b' }], { total: 25, page: 2, limit: 2, totalPages: 13 }));

    const page = await call();

    expect(get).toHaveBeenCalledWith(path, expect.anything());
    expect(page.items).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(page).toMatchObject({ total: 25, page: 2, totalPages: 13 });
  });

  it('an empty list is an empty page, not undefined', async () => {
    get.mockResolvedValue(serverList([], { total: 0, page: 1, limit: 12, totalPages: 0 }));
    expect(await videosApi.list()).toMatchObject({ items: [], total: 0 });
  });

  it('still reads the older { items } shape', async () => {
    get.mockResolvedValue({ data: { success: true, data: { items: [{ id: 'x' }], total: 1, page: 1 } } });
    expect((await magazineApi.list()).items).toEqual([{ id: 'x' }]);
  });
});
