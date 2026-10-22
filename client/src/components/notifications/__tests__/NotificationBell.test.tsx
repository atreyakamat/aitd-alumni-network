import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/dashboard' }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 'u1' } }) }));

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

import { NotificationBell } from '@/components/notifications/NotificationBell';

const make = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  userId: 'u1',
  type: 'POST_LIKED',
  title: `Title ${id}`,
  message: `Message ${id}`,
  link: null,
  isRead: false,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...extra,
});

let unread = 3;
let items: any[] = [];

const renderBell = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationBell />
    </QueryClientProvider>
  );
};

const bell = () => screen.getByRole('button', { name: /notifications/i });

beforeEach(() => {
  push.mockReset();
  unread = 3;
  items = [make('n1', { link: '/events/9' }), make('n2', { isRead: true }), make('n3', { link: 'https://evil.example/x' })];
  notificationApi.getUnreadCount.mockReset().mockImplementation(async () => ({ data: { success: true, data: { unreadCount: unread } } }));
  notificationApi.getNotifications.mockReset().mockImplementation(async () => ({
    data: { success: true, data: items, pagination: { total: items.length, page: 1, limit: 10, totalPages: 1 } },
  }));
  notificationApi.markAsRead.mockReset().mockResolvedValue({ data: { success: true } });
  notificationApi.markAllAsRead.mockReset().mockImplementation(async () => {
    unread = 0;
    items = items.map((n) => ({ ...n, isRead: true }));
    return { data: { success: true } };
  });
});

describe('<NotificationBell>', () => {
  it('shows the unread count badge', async () => {
    renderBell();
    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(bell()).toHaveAccessibleName(/3 unread/i);
  });

  it('hides the badge when nothing is unread and caps large counts', async () => {
    unread = 0;
    const { unmount } = renderBell();
    await waitFor(() => expect(notificationApi.getUnreadCount).toHaveBeenCalled());
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();
    unmount();

    unread = 250;
    renderBell();
    expect(await screen.findByText('99+')).toBeInTheDocument();
  });

  it('increments live when the socket delivers a notification', async () => {
    renderBell();
    expect(await screen.findByText('3')).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('socket:new_notification', { detail: make('n9') }));
    });
    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('lists recent notifications and marks all as read', async () => {
    renderBell();
    await screen.findByText('3');
    await userEvent.click(bell());

    const menu = await screen.findByRole('menu');
    expect(await within(menu).findByText('Title n1')).toBeInTheDocument();
    expect(within(menu).getByText('Message n2')).toBeInTheDocument();
    expect(within(menu).getAllByText(/ago$/).length).toBeGreaterThan(0);
    expect(notificationApi.getNotifications).toHaveBeenCalledWith(1, 10, false);

    await userEvent.click(within(menu).getByRole('menuitem', { name: /mark all as read/i }));
    expect(notificationApi.markAllAsRead).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument());
  });

  it('marks an unread item read and navigates to its internal link', async () => {
    renderBell();
    await screen.findByText('3');
    await userEvent.click(bell());
    await userEvent.click(await screen.findByRole('menuitem', { name: /title n1/i }));
    expect(notificationApi.markAsRead).toHaveBeenCalledWith('n1');
    expect(push).toHaveBeenCalledWith('/events/9');
  });

  it('does not follow external links', async () => {
    renderBell();
    await screen.findByText('3');
    await userEvent.click(bell());
    await userEvent.click(await screen.findByRole('menuitem', { name: /title n3/i }));
    expect(notificationApi.markAsRead).toHaveBeenCalledWith('n3');
    expect(push).not.toHaveBeenCalled();
  });

  it('links to the full notifications page', async () => {
    renderBell();
    await userEvent.click(bell());
    await userEvent.click(await screen.findByRole('menuitem', { name: /view all/i }));
    expect(push).toHaveBeenCalledWith('/notifications');
  });
});
