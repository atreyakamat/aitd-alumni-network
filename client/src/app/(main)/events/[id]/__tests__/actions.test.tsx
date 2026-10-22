import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useParams: () => ({ id: 'ev1' }),
  usePathname: () => '/events/ev1',
}));
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ fill, unoptimized, alt, ...props }: any) => <img alt={alt} {...props} />,
}));

const authState = vi.hoisted(() => ({ user: null as any, isAuthenticated: false }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => authState }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

const eventApi = vi.hoisted(() => ({ getEvent: vi.fn(), getAttendees: vi.fn(), rsvpEvent: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, eventApi };
});

import EventDetailsPage from '@/app/(main)/events/[id]/page';

const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
const EVENT = {
  id: 'ev1',
  title: 'Reunion 2026',
  description: 'Come along',
  startDate: future,
  eventType: 'OFFLINE',
  createdById: 'org1',
  createdBy: { id: 'org1', fullName: 'Priya Organiser', profilePhotoUrl: null },
};

const signIn = (user: any) => {
  authState.user = user;
  authState.isAuthenticated = !!user;
};

const setNavigator = (key: 'share' | 'clipboard', value: unknown) =>
  Object.defineProperty(window.navigator, key, { value, configurable: true, writable: true });

beforeEach(() => {
  toast.mockReset();
  eventApi.getEvent.mockReset().mockResolvedValue({ data: { data: EVENT } });
  eventApi.getAttendees.mockReset().mockResolvedValue({ data: { data: [] } });
  signIn({ id: 'u1' });
});

afterEach(() => {
  setNavigator('share', undefined);
  setNavigator('clipboard', undefined);
});

describe('Event detail: Share', () => {
  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', share);
    render(<EventDetailsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Share event' }));
    expect(share).toHaveBeenCalledWith({ title: 'Reunion 2026', url: window.location.href });
    expect(toast).not.toHaveBeenCalled();
  });

  it('stays quiet when the user dismisses the share sheet', async () => {
    setNavigator('share', vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' })));
    render(<EventDetailsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Share event' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(toast).not.toHaveBeenCalled();
  });

  it('copies the link and toasts when native share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('clipboard', { writeText });
    render(<EventDetailsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Share event' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Link copied' }));
  });

  it('reports a failure when the link cannot be copied', async () => {
    setNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    render(<EventDetailsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Share event' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' })));
  });
});

describe('Event detail: Contact Organizer', () => {
  it('shows the organizer and links members to a conversation with them', async () => {
    render(<EventDetailsPage />);
    expect(await screen.findByText('Priya Organiser')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact Organizer' })).toHaveAttribute('href', '/messages?u=org1');
  });

  it('is hidden from the organizer themself', async () => {
    signIn({ id: 'org1' });
    render(<EventDetailsPage />);
    await screen.findByText('Priya Organiser');
    expect(screen.queryByRole('link', { name: 'Contact Organizer' })).not.toBeInTheDocument();
  });

  it('sends anonymous visitors to login with a return path', async () => {
    signIn(null);
    render(<EventDetailsPage />);
    expect(await screen.findByRole('link', { name: 'Contact Organizer' })).toHaveAttribute('href', '/login?next=%2Fevents%2Fev1');
  });

  it('is hidden when the response has no organizer', async () => {
    eventApi.getEvent.mockResolvedValue({ data: { data: { ...EVENT, createdById: undefined, createdBy: undefined } } });
    render(<EventDetailsPage />);
    await screen.findByRole('heading', { name: 'Reunion 2026' });
    expect(screen.queryByRole('link', { name: 'Contact Organizer' })).not.toBeInTheDocument();
    expect(screen.getByText('Alumni Association')).toBeInTheDocument();
  });
});
