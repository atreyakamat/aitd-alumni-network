import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/directory',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'me', userRole: 'MEMBER' }, isAuthenticated: true }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const userApi = vi.hoisted(() => ({ getDirectory: vi.fn() }));
const networkApi = vi.hoisted(() => ({ getConnections: vi.fn(), getPendingRequests: vi.fn(), sendRequest: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, userApi, networkApi };
});

import DirectoryPage from '@/app/(main)/directory/page';

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  fullName: `Person ${id}`,
  batchYear: 2018,
  department: 'Computer Engineering',
  currentDesignation: null,
  city: null,
  ...extra,
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DirectoryPage />
    </QueryClientProvider>
  );

beforeEach(() => {
  userApi.getDirectory.mockReset();
  networkApi.getConnections.mockReset().mockResolvedValue({ data: { success: true, data: [], pagination: {} } });
  networkApi.getPendingRequests.mockReset().mockResolvedValue({ data: { success: true, data: { received: [], sent: [] } } });
  userApi.getDirectory.mockResolvedValue({
    data: {
      success: true,
      data: [row('a', { currentDesignation: 'Staff Engineer' }), row('b')],
      pagination: { total: 2, page: 1, limit: 12, totalPages: 1 },
    },
  });
});

describe('directory page', () => {
  it('does not print "No headline" under people who have not written one', async () => {
    renderPage();

    expect(await screen.findByText('Person a')).toBeInTheDocument();
    expect(screen.getByText('Staff Engineer')).toBeInTheDocument();
    expect(screen.queryByText('No headline')).not.toBeInTheDocument();
  });

  it('words the batch the same way as the rest of the site: "Class of 2018 • Department"', async () => {
    renderPage();

    await screen.findByText('Person a');
    expect(screen.getAllByText('Class of 2018 • Computer Engineering').length).toBe(2);
  });
});
