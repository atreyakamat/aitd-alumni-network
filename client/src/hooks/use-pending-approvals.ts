'use client';

import * as React from 'react';
import { adminApi } from '@/lib/api';

/** Fired on `window` by the approvals page after it approved or rejected somebody, so the badge follows at once. */
export const APPROVALS_CHANGED_EVENT = 'admin:approvals_changed';

/** Registrations come in at a human pace; this only catches the ones that arrive while the admin works elsewhere. */
const REFRESH_MS = 5 * 60 * 1000;

/**
 * How many registrations wait for an administrator to approve them, for the badge in the admin navigation.
 * `null` until known, for somebody who is not an administrator, and whenever the call fails: it is best effort and
 * must never break the navigation.
 */
export function usePendingApprovals(enabled: boolean): number | null {
  const [pending, setPending] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      setPending(null);
      return;
    }
    let active = true;

    const load = async () => {
      try {
        const count = (await adminApi.approvalSummary()).data?.data?.pending;
        if (active && typeof count === 'number' && Number.isFinite(count)) setPending(count);
      } catch {
        /* best effort: keep what we had */
      }
    };

    void load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener(APPROVALS_CHANGED_EVENT, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(APPROVALS_CHANGED_EVENT, load);
    };
  }, [enabled]);

  return enabled ? pending : null;
}
