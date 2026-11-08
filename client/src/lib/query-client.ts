import { QueryClient } from '@tanstack/react-query';

type MaybeApiError = { response?: { status?: number }; code?: string } | undefined | null;

const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Whether a failed query is worth asking again. A network failure, a timeout or a server that is briefly overloaded
 * usually recovers within seconds. A 400/401/403/404 will get the same answer every time, so retrying only delays the
 * error message (and, for 401, hammers the refresh endpoint).
 */
export const shouldRetryQuery = (failureCount: number, error: unknown): boolean => {
  if (failureCount >= MAX_RETRIES) return false;
  const status = (error as MaybeApiError)?.response?.status;
  if (status === undefined) return true; // no response at all: network down or timed out
  return RETRYABLE_STATUS.has(status);
};

/** 1s, 2s, 4s ... capped at 10s. */
export const retryDelay = (attempt: number): number => Math.min(1000 * 2 ** attempt, 10_000);

export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 5, // 5 minutes
        retry: shouldRetryQuery,
        retryDelay,
        refetchOnWindowFocus: false,
      },
    },
  });
