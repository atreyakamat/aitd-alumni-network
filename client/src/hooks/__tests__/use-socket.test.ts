import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const handlers = vi.hoisted(() => new Map<string, (data: unknown) => void>());
const fakeSocket = vi.hoisted(() => ({
  on: vi.fn((event: string, cb: (data: unknown) => void) => handlers.set(event, cb)),
  off: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
  connect: vi.fn(),
}));
const ioMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => fakeSocket));
vi.mock('socket.io-client', () => ({ io: (...args: unknown[]) => ioMock(...args) }));
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ isAuthenticated: true }) }));

import { useSocket } from '@/hooks/use-socket';

beforeEach(() => {
  handlers.clear();
  ioMock.mockClear();
  fakeSocket.connect.mockClear();
  window.localStorage.setItem('accessToken', 'tok');
});

describe('useSocket', () => {
  it('re-broadcasts new notifications as a window event for the bell', () => {
    const listener = vi.fn();
    window.addEventListener('socket:new_notification', listener);
    renderHook(() => useSocket());

    handlers.get('new_notification')!({ id: 'n1', title: 'Hi' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({ id: 'n1', title: 'Hi' });
    window.removeEventListener('socket:new_notification', listener);
  });

  it('no longer keeps a client-side notification counter (the bell reads it from the server)', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current).not.toHaveProperty('unreadNotifications');
    expect(result.current).not.toHaveProperty('resetUnreadNotifications');
    expect(result.current).toHaveProperty('unreadMessages');
  });
});

describe('useSocket token handling', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The `auth` option socket.io calls before every (re)connection attempt. */
  const authPayload = () => {
    const opts = ioMock.mock.calls[0][1] as { auth: (cb: (data: unknown) => void) => void };
    let payload: unknown;
    opts.auth((data) => {
      payload = data;
    });
    return payload;
  };

  it('reads the latest access token on every (re)connection attempt', () => {
    renderHook(() => useSocket());
    expect(authPayload()).toEqual({ token: 'tok' });

    window.localStorage.setItem('accessToken', 'rotated');
    expect(authPayload()).toEqual({ token: 'rotated' });
  });

  it('reconnects after the server closes the socket (e.g. tokens revoked by a password change)', () => {
    vi.useFakeTimers();
    renderHook(() => useSocket());

    handlers.get('disconnect')!('io server disconnect');
    vi.advanceTimersByTime(5000);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect a client-initiated or transport disconnect itself (socket.io handles those)', () => {
    vi.useFakeTimers();
    renderHook(() => useSocket());

    handlers.get('disconnect')!('io client disconnect');
    handlers.get('disconnect')!('transport close');
    vi.advanceTimersByTime(60000);
    expect(fakeSocket.connect).not.toHaveBeenCalled();
  });

  it('retries a rejected handshake with backoff, a bounded number of times', () => {
    vi.useFakeTimers();
    renderHook(() => useSocket());

    for (let i = 0; i < 10; i++) {
      handlers.get('connect_error')!(new Error('Invalid token'));
      vi.advanceTimersByTime(60000);
    }
    expect(fakeSocket.connect).toHaveBeenCalledTimes(5);

    // A successful connection resets the budget
    handlers.get('connect')!(undefined);
    handlers.get('connect_error')!(new Error('Invalid token'));
    vi.advanceTimersByTime(60000);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(6);
  });

  it('stops retrying once the user is signed out (no token)', () => {
    vi.useFakeTimers();
    renderHook(() => useSocket());

    window.localStorage.removeItem('accessToken');
    handlers.get('connect_error')!(new Error('Invalid token'));
    vi.advanceTimersByTime(60000);
    expect(fakeSocket.connect).not.toHaveBeenCalled();
  });
});
