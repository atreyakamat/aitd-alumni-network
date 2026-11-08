'use client';

import * as React from 'react';
import { useToast } from '@/hooks/use-toast';

/** A page can fire a dozen requests at once; when the server is down they all fail together. Say it once. */
export const THROTTLE_MS = 10_000;

/**
 * The API client announces connection problems, server errors and an expired session as window events
 * (`lib/api.ts`). Without a listener they were silent: a member whose connection dropped saw a spinner that never ended.
 * This turns them into one clear message each, and renders nothing.
 */
export function ApiStatusToasts() {
  const { toast } = useToast();
  const lastShown = React.useRef<Record<string, number>>({});

  React.useEffect(() => {
    const announce = (kind: string, title: string, description: string) => {
      const now = Date.now();
      if (now - (lastShown.current[kind] ?? -Infinity) < THROTTLE_MS) return;
      lastShown.current[kind] = now;
      toast({ variant: 'destructive', title, description });
    };

    const onNetwork = () =>
      announce('network', 'Cannot reach the server', 'Check your internet connection. We will keep trying.');
    const onServer = () =>
      announce('server', 'Something went wrong on our side', 'Please try again in a moment. If it keeps happening, tell us.');
    const onSession = () =>
      announce('session', 'Your session has ended', 'For your security you have been signed out. Please sign in again.');

    window.addEventListener('api:network_error', onNetwork);
    window.addEventListener('api:server_error', onServer);
    window.addEventListener('api:session_expired', onSession);
    return () => {
      window.removeEventListener('api:network_error', onNetwork);
      window.removeEventListener('api:server_error', onServer);
      window.removeEventListener('api:session_expired', onSession);
    };
  }, [toast]);

  return null;
}
