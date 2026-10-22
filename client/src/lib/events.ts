import { getApiErrorMessage } from '@/lib/api';

export interface AttendeeView {
  userId: string;
  fullName: string;
  profilePhotoUrl?: string | null;
  batchYear?: number | null;
  /** Only present for the event owner / admins. */
  email?: string;
}

/**
 * The attendees endpoint returns flat user rows ({ id, fullName, ..., userId }).
 * Older responses nested them under `user`; accept both.
 */
export function normalizeAttendee(raw: any): AttendeeView {
  const person = raw?.user ?? raw ?? {};
  return {
    userId: raw?.userId ?? person.id,
    fullName: person.fullName ?? 'Member',
    profilePhotoUrl: person.profilePhotoUrl ?? null,
    batchYear: person.batchYear ?? null,
    ...(typeof person.email === 'string' ? { email: person.email } : {}),
  };
}

/** API field is `capacity`; legacy UI used `maxAttendees`. null = unlimited. */
export function getEventCapacity(event: any): number | null {
  const value = event?.capacity ?? event?.maxAttendees;
  return typeof value === 'number' && value > 0 ? value : null;
}

export function getEventLocation(event: any): string | null {
  const parts = [event?.venue ?? event?.location, event?.city].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  return parts.length ? parts.join(', ') : null;
}

export function isVirtualEvent(event: any): boolean {
  return event?.eventType === 'ONLINE' || event?.isVirtual === true;
}

/** Friendly RSVP failures (409 EVENT_FULL, 400 EVENT_PAST, ...). */
export function getRsvpErrorMessage(err: unknown): string {
  const code = (err as any)?.response?.data?.error?.code;
  switch (code) {
    case 'EVENT_FULL':
      return 'This event is at full capacity, so new RSVPs are closed.';
    case 'EVENT_PAST':
      return 'This event has already started, so RSVPs are closed.';
    case 'EVENT_NOT_AVAILABLE':
      return 'This event is not open for RSVPs.';
    default:
      return getApiErrorMessage(err, 'Could not update your RSVP. Please try again.');
  }
}
