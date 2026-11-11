import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface AdminErrorStateProps {
  title: string;
  /** Already friendly (from `getApiErrorMessage`). */
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** True while the retry is running. */
  retrying?: boolean;
}

/** What an admin page shows when its data could not be loaded: what failed, why, and a way to try again. */
export function AdminErrorState({ title, message, onRetry, retryLabel = 'Retry', retrying = false }: AdminErrorStateProps) {
  return (
    <Card role="alert">
      <CardContent className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200">
          <TriangleAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry} disabled={retrying}>
            {retrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
            {retryLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
