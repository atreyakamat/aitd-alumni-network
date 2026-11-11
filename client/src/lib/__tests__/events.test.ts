import { describe, expect, it } from 'vitest';
import {
  getEventCapacity,
  eventPlaceLabel,
  getEventLocation,
  getRsvpErrorMessage,
  isVirtualEvent,
  normalizeAttendee,
} from '@/lib/events';

const apiError = (code: string, message = 'server says no') => ({
  response: { data: { success: false, error: { code, message } } },
});

describe('event helpers', () => {
  it('normalizes flat and nested attendee rows', () => {
    expect(normalizeAttendee({ id: 'u1', userId: 'u1', fullName: 'Ada', batchYear: 2010 })).toEqual({
      userId: 'u1',
      fullName: 'Ada',
      profilePhotoUrl: null,
      batchYear: 2010,
    });
    expect(normalizeAttendee({ id: 'r1', user: { id: 'u2', fullName: 'Bo', email: 'b@x.io' } })).toMatchObject({
      userId: 'u2',
      fullName: 'Bo',
      email: 'b@x.io',
    });
  });

  it('reads capacity (falling back to maxAttendees)', () => {
    expect(getEventCapacity({ capacity: 50 })).toBe(50);
    expect(getEventCapacity({ maxAttendees: 10 })).toBe(10);
    expect(getEventCapacity({ capacity: null })).toBeNull();
    expect(getEventCapacity({})).toBeNull();
  });

  it('builds a location from venue/city', () => {
    expect(getEventLocation({ venue: 'Hall A', city: 'Pune' })).toBe('Hall A, Pune');
    expect(getEventLocation({ city: 'Pune' })).toBe('Pune');
    expect(getEventLocation({})).toBeNull();
  });

  it('labels where an event happens in one consistent way', () => {
    // an online event has no venue: it is "Online", not "Location TBD"
    expect(eventPlaceLabel({ eventType: 'ONLINE' })).toBe('Online');
    expect(eventPlaceLabel({ eventType: 'ONLINE', city: 'Pune' })).toBe('Online');
    expect(eventPlaceLabel({ eventType: 'OFFLINE', venue: 'College Auditorium', city: 'Assagao' })).toBe('College Auditorium, Assagao');
    expect(eventPlaceLabel({ eventType: 'HYBRID', venue: 'Hall A' })).toBe('Hall A');
    expect(eventPlaceLabel({ eventType: 'OFFLINE' })).toBe('Location to be announced');
    expect(eventPlaceLabel(null)).toBe('Location to be announced');
  });

  it('detects virtual events by eventType', () => {
    expect(isVirtualEvent({ eventType: 'ONLINE' })).toBe(true);
    expect(isVirtualEvent({ eventType: 'HYBRID' })).toBe(false);
  });

  it('maps RSVP error codes to friendly messages', () => {
    expect(getRsvpErrorMessage(apiError('EVENT_FULL'))).toMatch(/full capacity/i);
    expect(getRsvpErrorMessage(apiError('EVENT_PAST'))).toMatch(/already started/i);
    expect(getRsvpErrorMessage(apiError('OTHER', 'Custom'))).toBe('Custom');
  });
});
