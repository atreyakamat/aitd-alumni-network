'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '@/lib/api';
import type { CursorPage } from '@/lib/social';

export type FetchPage<T> = (cursor: string | null, signal: AbortSignal) => Promise<CursorPage<T>>;

export interface CursorList<T> {
  items: T[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  /** Put items at the top (e.g. a post the viewer just created), skipping ids already listed. */
  prepend: (...items: T[]) => void;
  update: (id: string, fn: (item: T) => T) => void;
  remove: (id: string) => void;
  setItems: React.Dispatch<React.SetStateAction<T[]>>;
}

/** Append `incoming` to `current`, dropping items whose id is already present. */
export function appendUnique<T>(current: T[], incoming: T[], getId: (item: T) => string): T[] {
  const seen = new Set(current.map(getId));
  const out = [...current];
  for (const item of incoming) {
    const id = getId(item);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(item);
    }
  }
  return out;
}

/**
 * Cursor-paginated list state. Refetches from the first page whenever `key` changes, aborts
 * stale requests, ignores late responses and de-duplicates items by id across pages.
 */
export function useCursorList<T>(
  fetchPage: FetchPage<T>,
  key: string,
  getId: (item: T) => string,
  { enabled = true }: { enabled?: boolean } = {}
): CursorList<T> {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const getIdRef = useRef(getId);
  getIdRef.current = getId;
  const controllerRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const run = useCallback(async (from: string | null, append: boolean) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const request = ++requestRef.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const page = await fetchRef.current(from, controller.signal);
      if (request !== requestRef.current) return;
      setItems((prev) => (append ? appendUnique(prev, page.items, getIdRef.current) : appendUnique([], page.items, getIdRef.current)));
      setCursor(page.nextCursor);
      setHasMore(Boolean(page.nextCursor));
    } catch (err) {
      if (request !== requestRef.current || controller.signal.aborted) return;
      const e = err as { name?: string; code?: string };
      if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return;
      setError(getApiErrorMessage(err, 'Something went wrong while loading.'));
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setItems([]);
    setCursor(null);
    setHasMore(false);
    void run(null, false);
    return () => {
      controllerRef.current?.abort();
    };
  }, [key, enabled, generation, run]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore || !cursor) return;
    void run(cursor, true);
  }, [cursor, hasMore, loading, loadingMore, run]);

  const reload = useCallback(() => setGeneration((g) => g + 1), []);

  const prepend = useCallback((...newItems: T[]) => {
    setItems((prev) => {
      const ids = new Set(prev.map(getIdRef.current));
      return [...newItems.filter((i) => !ids.has(getIdRef.current(i))), ...prev];
    });
  }, []);

  const update = useCallback((id: string, fn: (item: T) => T) => {
    setItems((prev) => prev.map((item) => (getIdRef.current(item) === id ? fn(item) : item)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => getIdRef.current(item) !== id));
  }, []);

  return { items, loading, loadingMore, error, hasMore, loadMore, reload, prepend, update, remove, setItems };
}
