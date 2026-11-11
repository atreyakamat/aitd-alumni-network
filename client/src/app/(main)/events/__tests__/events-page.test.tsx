import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/events',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', userRole: 'MEMBER' }, isAuthenticated: true }) }));
vi.mock('@/components/events/CreateEventDialog', () => ({ CreateEventDialog: () => null }));

const eventApi = vi.hoisted(() => ({ getEvents: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, eventApi };
});

import EventsPage from '@/app/(main)/events/page';

const event = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Event ${id}`,
  description: 'Details',
  eventType: 'OFFLINE',
  startDate: '2026-12-20T10:00:00.000Z',
  venue: 'College Auditorium',
  city: 'Assagao',
  _count: { rsvps: 3 },
  ...extra,
});

const answer = (events: unknown[]) => ({ data: { success: true, data: events, pagination: { total: events.length, page: 1, totalPages: 1 } } });

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EventsPage />
    </QueryClientProvider>
  );

beforeEach(() => {
  eventApi.getEvents.mockReset();
  eventApi.getEvents.mockResolvedValue(answer([event('1')]));
});

describe('events page', () => {
  it('shows upcoming events by default and says so honestly', async () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Events' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Upcoming' })).toHaveAttribute('aria-selected', 'true');
    await screen.findByText('Event 1');
    expect(eventApi.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ upcoming: true }));
    expect(eventApi.getEvents.mock.lastCall?.[0]).not.toHaveProperty('past');
  });

  it('lists events that already happened under "Past", not under "Upcoming"', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Event 1');

    eventApi.getEvents.mockResolvedValue(answer([event('old', { title: 'Reunion 2025', startDate: '2025-05-15T10:00:00.000Z' })]));
    await user.click(screen.getByRole('tab', { name: 'Past' }));

    await screen.findByText('Reunion 2025');
    expect(screen.getByRole('tab', { name: 'Past' })).toHaveAttribute('aria-selected', 'true');
    expect(eventApi.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ past: true, page: 1 }));
    expect(eventApi.getEvents.mock.lastCall?.[0]).not.toHaveProperty('upcoming');
  });

  it('words the place of every event consistently: Online, venue and city, or "to be announced"', async () => {
    eventApi.getEvents.mockResolvedValue(
      answer([
        event('a', { title: 'Webinar', eventType: 'ONLINE', venue: null, city: null }),
        event('b', { title: 'Reunion' }),
        event('c', { title: 'Mystery', venue: null, city: null }),
      ])
    );
    renderPage();

    await screen.findByText('Webinar');
    expect(screen.getAllByText('Online').length).toBeGreaterThan(0);
    expect(screen.getByText('College Auditorium, Assagao')).toBeInTheDocument();
    expect(screen.getByText('Location to be announced')).toBeInTheDocument();
    expect(screen.queryByText('Location TBD')).not.toBeInTheDocument();
  });

  it('has a different empty message on each tab', async () => {
    const user = userEvent.setup();
    eventApi.getEvents.mockResolvedValue(answer([]));
    renderPage();

    expect(await screen.findByText('No upcoming events')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Past' }));
    await waitFor(() => expect(screen.getByText('No past events')).toBeInTheDocument());
  });
});
