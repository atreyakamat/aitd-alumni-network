'use client';

import * as React from 'react';
import { adminApi, getApiErrorMessage } from '@/lib/api';
import { normalizeAdminStats, type AdminStats } from '@/lib/admin-stats';

/**
 * Loads `GET /api/admin/stats` for the dashboard and the analytics page, already normalised (see `normalizeAdminStats`).
 * `loading` is true during every load, including a refresh that keeps showing the previous numbers; `stats` stays what it
 * was while a refresh runs or fails, so a failed refresh never blanks a page that was showing data.
 */
export function useAdminStats(errorFallback: string) {
  const [stats, setStats] = React.useState<AdminStats | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Only the newest request may update the state: an older answer (or one that arrives after leaving the page) is dropped.
  const latest = React.useRef(0);

  const load = React.useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const response = await adminApi.getStats();
      if (mine !== latest.current) return;
      setStats(normalizeAdminStats(response.data?.data));
    } catch (err) {
      if (mine !== latest.current) return;
      setError(getApiErrorMessage(err, errorFallback));
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [errorFallback]);

  React.useEffect(() => {
    void load();
    return () => {
      latest.current += 1;
    };
  }, [load]);

  return { stats, loading, error, reload: load };
}
