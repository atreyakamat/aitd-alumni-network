import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/notifications' }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'u1' } }) }));
const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const notificationApi = vi.hoisted(() => ({
  getUnreadCount: vi.fn(),
  getNotifications: vi.fn(),
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  deleteNotification: vi.fn(),
}));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, notificationApi };
});

import NotificationsPage from '@/app/(main)/notifications/page';

const make = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  type: 'CONNECTION_REQUEST',
  title: `Title ${id}`,
  message: `Message ${id}`,
  link: '/network/requests',
  isRead: false,
  createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
  ...extra,
});

let store: any[] = [];

const page = (body: any[], pageNo = 1, totalPages = 1) => ({
  data: { success: true, data: body, pagination: { total: body.length, page: pageNo, limit: 20, totalPages } },
});

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsPage />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  push.mockReset();
  toast.mockReset();
  store = [make('n1'), make('n2', { isRead: true, link: null })];
  notificationApi.getUnreadCount.mockReset().mockImplementation(async () => ({
    data: { data: { unreadCount: store.filter((n) => !n.isRead).length } },
  }));
  notificationApi.getNotifications.mockReset().mockImplementation(async (_p: number, _l: number, unreadOnly: boolean) =>
    page(unreadOnly ? store.filter((n) => !n.isRead) : store)
  );
  notificationApi.markAsRead.mockReset().mockImplementation(async (id: string) => {
    store = store.map((n) => (n.id === id ? { ...n, isRead: true } : n));
    return { data: { success: true } };
  });
  notificationApi.markAllAsRead.mockReset().mockImplementation(async () => {
    store = store.map((n) => ({ ...n, isRead: true }));
    return { data: { success: true } };
  });
  notificationApi.deleteNotification.mockReset().mockImplementation(async (id: string) => {
    store = store.filter((n) => n.id !== id);
    return { data: { success: true } };
  });
});

describe('Notifications page', () => {
  it('shows a loading state, then the list with unread summary', async () => {
    renderPage();
    expect(screen.getByRole('status', { name: /loading notifications/i })).toBeInTheDocument();
    expect(await screen.findByText('Title n1')).toBeInTheDocument();
    expect(screen.getByText('Message n2')).toBeInTheDocument();
    expect(await screen.findByText(/you have 1 unread notification\./i)).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    store = [];
    renderPage();
    expect(await screen.findByText(/no notifications yet/i)).toBeInTheDocument();
  });

  it('shows an error state with retry', async () => {
    notificationApi.getNotifications.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { response: { status: 500, data: { success: false, error: { message: 'Server down' } } } })
    );
    renderPage();
    expect(await screen.findByText(/couldn't load notifications/i)).toBeInTheDocument();
    expect(screen.getByText('Server down')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Title n1')).toBeInTheDocument();
  });

  it('filters to unread notifications', async () => {
    renderPage();
    await screen.findByText('Title n1');
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await waitFor(() => expect(notificationApi.getNotifications).toHaveBeenLastCalledWith(1, 20, true));
    await waitFor(() => expect(screen.queryByText('Title n2')).not.toBeInTheDocument());
    expect(screen.getByText('Title n1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unread' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the unread empty state when everything is read', async () => {
    store = [make('n2', { isRead: true })];
    renderPage();
    await screen.findByText('Title n2');
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    expect(await screen.findByText(/no unread notifications/i)).toBeInTheDocument();
  });

  it('marks a single notification as read', async () => {
    renderPage();
    await screen.findByText('Title n1');
    await userEvent.click(screen.getByRole('button', { name: /mark "title n1" as read/i }));
    expect(notificationApi.markAsRead).toHaveBeenCalledWith('n1');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /mark "title n1" as read/i })).not.toBeInTheDocument()
    );
  });

  it('marks all as read', async () => {
    renderPage();
    await screen.findByText(/you have 1 unread/i);
    await userEvent.click(screen.getByRole('button', { name: /mark all as read/i }));
    expect(notificationApi.markAllAsRead).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/you're all caught up/i)).toBeInTheDocument();
  });

  it('deletes a notification', async () => {
    renderPage();
    await screen.findByText('Title n2');
    await userEvent.click(screen.getByRole('button', { name: /delete "title n2"/i }));
    expect(notificationApi.deleteNotification).toHaveBeenCalledWith('n2');
    await waitFor(() => expect(screen.queryByText('Title n2')).not.toBeInTheDocument());
  });

  it('reports failed actions with a toast', async () => {
    notificationApi.deleteNotification.mockRejectedValueOnce(new Error('nope'));
    renderPage();
    await screen.findByText('Title n2');
    await userEvent.click(screen.getByRole('button', { name: /delete "title n2"/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Could not delete notification' }))
    );
    expect(await screen.findByText('Title n2')).toBeInTheDocument();
  });

  it('opening an unread notification marks it read and follows its link', async () => {
    renderPage();
    await screen.findByText('Title n1');
    await userEvent.click(screen.getByRole('button', { name: /title n1 \(unread\), open/i }));
    expect(notificationApi.markAsRead).toHaveBeenCalledWith('n1');
    // Legacy link mapped to a real route.
    expect(push).toHaveBeenCalledWith('/network');
  });

  it('paginates', async () => {
    notificationApi.getNotifications.mockImplementation(async (p: number) =>
      page(p === 1 ? [make('p1')] : [make('p2')], p, 2)
    );
    renderPage();
    await screen.findByText('Title p1');
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Title p2')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });
});
