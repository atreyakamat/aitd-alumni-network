import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/yearbook',
  useSearchParams: () => new URLSearchParams(),
}));

let authUser: { id: string; batchYear?: number } | null = { id: 'u1', batchYear: 2018 };
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: authUser, isAuthenticated: !!authUser }) }));

const userApi = vi.hoisted(() => ({ getYearbook: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, userApi };
});

import YearbookPage from '@/app/(main)/yearbook/page';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <YearbookPage />
    </QueryClientProvider>
  );

beforeEach(() => {
  userApi.getYearbook.mockReset();
  userApi.getYearbook.mockResolvedValue({ data: { success: true, data: [] } });
  authUser = { id: 'u1', batchYear: 2018 };
});

describe('yearbook page', () => {
  it('opens on the member\'s own batch, not on a year nobody has graduated yet', async () => {
    renderPage();

    expect(await screen.findByText('Class of 2018')).toBeInTheDocument();
    expect(userApi.getYearbook).toHaveBeenCalledWith(2018, undefined);
  });

  it('falls back to the current year when the batch is not known', async () => {
    authUser = { id: 'u1' };
    renderPage();

    expect(await screen.findByText(`Class of ${new Date().getFullYear()}`)).toBeInTheDocument();
    expect(userApi.getYearbook).toHaveBeenCalledWith(new Date().getFullYear(), undefined);
  });

  it('still offers an old batch that falls outside the usual range of years', async () => {
    authUser = { id: 'u1', batchYear: 1985 };
    renderPage();

    expect(await screen.findByText('Class of 1985')).toBeInTheDocument();
    expect(userApi.getYearbook).toHaveBeenCalledWith(1985, undefined);
  });
});
