import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const approvalSummary = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, adminApi: { ...actual.adminApi, approvalSummary: (...args: unknown[]) => approvalSummary(...args) } };
});

import { APPROVALS_CHANGED_EVENT, usePendingApprovals } from '@/hooks/use-pending-approvals';

const summary = (pending: number) => ({ data: { success: true, data: { pending, approved: 40, rejected: 2 } } });

beforeEach(() => {
  approvalSummary.mockReset().mockResolvedValue(summary(3));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('usePendingApprovals (the badge in the admin navigation)', () => {
  it('asks nothing and returns null for somebody who is not an administrator', () => {
    const { result } = renderHook(() => usePendingApprovals(false));
    expect(result.current).toBeNull();
    expect(approvalSummary).not.toHaveBeenCalled();
  });

  it('returns the number of registrations that wait for approval', async () => {
    const { result } = renderHook(() => usePendingApprovals(true));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(3));
    expect(approvalSummary).toHaveBeenCalledTimes(1);
  });

  it('is best effort: a failing call gives null and never throws', async () => {
    approvalSummary.mockRejectedValue(new Error('Network Error'));
    const { result } = renderHook(() => usePendingApprovals(true));
    await waitFor(() => expect(approvalSummary).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('ignores an answer of an unexpected shape', async () => {
    approvalSummary.mockResolvedValue({ data: { success: true, data: { pending: 'many' } } });
    const { result } = renderHook(() => usePendingApprovals(true));
    await waitFor(() => expect(approvalSummary).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('asks again when the approvals page reports that it decided something', async () => {
    const { result } = renderHook(() => usePendingApprovals(true));
    await waitFor(() => expect(result.current).toBe(3));

    approvalSummary.mockResolvedValue(summary(2));
    act(() => void window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT)));
    await waitFor(() => expect(result.current).toBe(2));
  });

  it('keeps the last number when a later refresh fails', async () => {
    const { result } = renderHook(() => usePendingApprovals(true));
    await waitFor(() => expect(result.current).toBe(3));

    approvalSummary.mockRejectedValue(new Error('boom'));
    act(() => void window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT)));
    await waitFor(() => expect(approvalSummary).toHaveBeenCalledTimes(2));
    expect(result.current).toBe(3);
  });

  it('stops listening when it is removed', async () => {
    const { result, unmount } = renderHook(() => usePendingApprovals(true));
    await waitFor(() => expect(result.current).toBe(3));
    unmount();
    window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT));
    expect(approvalSummary).toHaveBeenCalledTimes(1);
  });
});
