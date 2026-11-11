'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  CheckCircle2,
  CreditCard,
  Database,
  HardDrive,
  Loader2,
  Mail,
  MessageSquare,
  MinusCircle,
  RefreshCw,
  Search,
  Server,
  TriangleAlert,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { adminApi, getApiErrorMessage, type SystemServiceState, type SystemStatus } from '@/lib/api';
import { normalizeSystemStatus } from '@/lib/system-status';
import { formatTime, formatUptime } from '@/lib/format';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminErrorState } from '@/components/admin/AdminErrorState';

type Look = { label: string; icon: LucideIcon; pill: string };

const LOOKS: Record<SystemServiceState, Look> = {
  ok: { label: 'Working', icon: CheckCircle2, pill: 'border-green-300 bg-green-100 text-green-800 dark:border-green-700 dark:bg-green-900/40 dark:text-green-100' },
  warning: { label: 'Needs attention', icon: TriangleAlert, pill: 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100' },
  error: { label: 'Problem', icon: XCircle, pill: 'border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-100' },
  off: { label: 'Not in use', icon: MinusCircle, pill: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200' },
};

const BANNERS: Record<SystemStatus['overall'], { title: string; text: string; box: string; icon: string }> = {
  ok: {
    title: 'All systems working',
    text: `Everything ${BRAND.appName} depends on is running normally.`,
    box: 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30',
    icon: 'text-green-600',
  },
  warning: {
    title: 'Needs attention',
    text: 'Something below needs a look. If it stays like this, please tell your technical team.',
    box: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30',
    icon: 'text-amber-600',
  },
  error: {
    title: 'Problem',
    text: 'Something important is not working. Please contact your technical team.',
    box: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/30',
    icon: 'text-red-600',
  },
};

const BANNER_ICONS: Record<SystemStatus['overall'], LucideIcon> = { ok: CheckCircle2, warning: TriangleAlert, error: XCircle };

/** An icon for what the service is, from its key (the server names them: database, email, storage, ...). */
const serviceIcon = (key: string): LucideIcon => {
  const k = key.toLowerCase();
  if (/data|db|postgres|sql/.test(k)) return Database;
  if (/mail|smtp/.test(k)) return Mail;
  if (/stor|upload|file|bucket|s3/.test(k)) return HardDrive;
  if (/notif|kafka|queue|bus|push/.test(k)) return Bell;
  if (/pay|razorpay|stripe|billing/.test(k)) return CreditCard;
  if (/cache|redis/.test(k)) return Zap;
  if (/search/.test(k)) return Search;
  if (/socket|chat|realtime|message/.test(k)) return MessageSquare;
  return Server;
};

function StatusPill({ state }: { state: SystemServiceState }) {
  const look = LOOKS[state];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', look.pill)}>
      <look.icon className="h-3 w-3" aria-hidden="true" />
      {look.label}
    </span>
  );
}

function StatusSkeleton() {
  return (
    <div role="status" aria-label="Checking systems" className="space-y-6">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-5 w-1/3" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AdminStatusPage() {
  const query = useQuery({
    queryKey: ['admin', 'system-status'],
    queryFn: async () => normalizeSystemStatus((await adminApi.getSystemStatus()).data?.data),
    // A health check is only worth anything when it is fresh: ask again on every visit, and report a failure at once.
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  const data = query.data;
  const checking = query.isFetching;

  const checkAgain = (
    <Button variant="outline" onClick={() => void query.refetch()} disabled={checking}>
      {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />}
      {checking ? 'Checking…' : 'Check again'}
    </Button>
  );

  const environment = data?.environment ? data.environment.charAt(0).toUpperCase() + data.environment.slice(1) : '';

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="System status"
        icon={Activity}
        description={`Whether everything ${BRAND.appName} depends on is working: the database, e-mail, file storage and more.`}
        actions={data ? checkAgain : undefined}
      />

      {query.isLoading ? (
        <StatusSkeleton />
      ) : query.isError && !data ? (
        <AdminErrorState
          title="Could not check the system status"
          message={getApiErrorMessage(query.error, 'The status check did not work. Please try again.')}
          onRetry={() => void query.refetch()}
          retrying={checking}
        />
      ) : data ? (
        <>
          {query.isError && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              <AlertDescription>
                Could not check again: {getApiErrorMessage(query.error, 'the status check did not work.')} The result below is from the last check that worked.
              </AlertDescription>
            </Alert>
          )}

          <BannerView overall={data.overall} />

          {data.services.length > 0 && (
            <ul aria-label="Services" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.services.map((service) => {
                const Icon = serviceIcon(service.key);
                return (
                  <li key={service.key}>
                    <Card className="h-full">
                      <CardContent className="space-y-3 pt-6">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Icon className="h-5 w-5" aria-hidden="true" />
                            </span>
                            <h2 className="truncate text-base font-semibold">{service.label}</h2>
                          </div>
                          <StatusPill state={service.status} />
                        </div>
                        {service.detail && <p className="text-sm text-muted-foreground">{service.detail}</p>}
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Last checked {formatTime(data.checkedAt || query.dataUpdatedAt)}</span>{' '}
            {environment && <span>Environment: {environment}</span>}{' '}
            {data.version && <span>Version {data.version}</span>}{' '}
            {data.uptimeSeconds > 0 && <span>Running for {formatUptime(data.uptimeSeconds)}</span>}
          </p>
        </>
      ) : null}
    </div>
  );
}

function BannerView({ overall }: { overall: SystemStatus['overall'] }) {
  const banner = BANNERS[overall];
  const Icon = BANNER_ICONS[overall];
  return (
    <div role="status" aria-label="Overall status" className={cn('flex items-start gap-4 rounded-lg border p-5', banner.box)}>
      <Icon className={cn('mt-0.5 h-8 w-8 shrink-0', banner.icon)} aria-hidden="true" />
      <div>
        <p className="text-lg font-semibold">{banner.title}</p>
        <p className="text-sm text-muted-foreground">{banner.text}</p>
      </div>
    </div>
  );
}
