'use client';

import * as React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/lib/query-client';
import { ApiStatusToasts } from '@/components/layout/ApiStatusToasts';
import { AuthProvider } from './auth-context';
import { SocketProvider } from './socket-context';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApiStatusToasts />
        <SocketProvider>{children}</SocketProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
