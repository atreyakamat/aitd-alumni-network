import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));

import { ApiStatusToasts, THROTTLE_MS } from '@/components/layout/ApiStatusToasts';

const fire = (name: string, detail?: unknown) => act(() => void window.dispatchEvent(new CustomEvent(name, { detail })));

beforeEach(() => {
  vi.useFakeTimers();
  toast.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ApiStatusToasts', () => {
  it('tells the member when the connection to the server is lost', () => {
    render(<ApiStatusToasts />);
    fire('api:network_error', { message: 'Network error. Please check your connection.' });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ variant: 'destructive', title: expect.stringMatching(/connection|offline|reach/i) });
  });

  it('tells the member when the server had a problem, using the status but not the internals', () => {
    render(<ApiStatusToasts />);
    fire('api:server_error', { message: 'Server error. Please try again later.', status: 500 });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0].title).toMatch(/our side|server|wrong/i);
  });

  it('explains an expired session', () => {
    render(<ApiStatusToasts />);
    fire('api:session_expired', { message: 'Your session has expired. Please log in again.' });
    expect(toast.mock.calls[0][0]).toMatchObject({ title: expect.stringMatching(/session/i) });
  });

  it('shows a burst of identical failures once (a page can fire a dozen requests at the same moment)', () => {
    render(<ApiStatusToasts />);
    for (let i = 0; i < 12; i++) fire('api:network_error');
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it('shows the same problem again after the throttle window', () => {
    render(<ApiStatusToasts />);
    fire('api:network_error');
    act(() => void vi.advanceTimersByTime(THROTTLE_MS + 1));
    fire('api:network_error');
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it('throttles each kind of problem separately', () => {
    render(<ApiStatusToasts />);
    fire('api:network_error');
    fire('api:server_error', { status: 503 });
    fire('api:session_expired');
    expect(toast).toHaveBeenCalledTimes(3);
  });

  it('stops listening when it is removed', () => {
    const { unmount } = render(<ApiStatusToasts />);
    unmount();
    fire('api:network_error');
    expect(toast).not.toHaveBeenCalled();
  });

  it('copes with events that carry no detail', () => {
    render(<ApiStatusToasts />);
    expect(() => fire('api:server_error')).not.toThrow();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
