'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * A page inside the signed-in area failed to render. This boundary sits INSIDE the layout, so the navigation stays and the
 * member can move on or try again; without it the whole screen, header included, was replaced.
 */
export default function MainError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 rounded-full bg-destructive/10 p-4">
        <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      </div>
      <h1 className="mb-3 text-3xl font-bold">Something went wrong</h1>
      <p className="mb-2 max-w-md text-muted-foreground">
        This page could not be shown. Your work elsewhere is safe. Try again, or carry on from the dashboard.
      </p>
      {error.digest && <p className="mb-6 text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="mt-4 flex gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
