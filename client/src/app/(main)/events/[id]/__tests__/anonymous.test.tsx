import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, back: vi.fn() }),
  useParams: () => ({ id: 'ev1' }),
  usePathname: () => '/events/ev1',
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, unoptimized, alt, ...props }: any) => <img alt={alt} {...props} />,
}));

const authState = vi.hoisted(() => ({ user: null as any, isAuthenticated: false }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const eventApi = vi.hoisted(() => ({ getEvent: vi.fn(), getAttendees: vi.fn(), rsvpEvent: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, eventApi };
});

import EventDetailsPage from '@/app/(main)/events/[id]/page';

const future = new Date(Date.now() + 7 * 86_400_000).toISOString();

beforeEach(() => {
  push.mockReset();
  eventApi.getEvent.mockReset().mockResolvedValue({
    data: { data: { id: 'ev1', title: 'Reunion 2026', description: 'Come along', startDate: future, eventType: 'OFFLINE' } },
  });
  eventApi.getAttendees.mockReset().mockResolvedValue({ data: { data: [] } });
  eventApi.rsvpEvent.mockReset();
});

describe('Event detail page for anonymous visitors', () => {
  it('loads the event without calling members-only endpoints', async () => {
    authState.user = null;
    authState.isAuthenticated = false;
    render(<EventDetailsPage />);
    expect(await screen.findByRole('heading', { name: 'Reunion 2026' })).toBeInTheDocument();
    expect(eventApi.getAttendees).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login?next=%2Fevents%2Fev1');
  });

  it('sends RSVP attempts to login with a return path', async () => {
    authState.user = null;
    authState.isAuthenticated = false;
    render(<EventDetailsPage />);
    await userEvent.click(await screen.findByRole('button', { name: /sign in to rsvp/i }));
    expect(push).toHaveBeenCalledWith('/login?next=%2Fevents%2Fev1');
    expect(eventApi.rsvpEvent).not.toHaveBeenCalled();
  });

  it('members still get the attendee list and RSVP', async () => {
    authState.user = { id: 'u1' };
    authState.isAuthenticated = true;
    render(<EventDetailsPage />);
    expect(await screen.findByRole('button', { name: /register for event/i })).toBeInTheDocument();
    expect(eventApi.getAttendees).toHaveBeenCalledWith('ev1');
  });
});
