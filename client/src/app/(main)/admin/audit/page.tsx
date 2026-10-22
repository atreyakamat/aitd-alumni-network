'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { AlertCircle, ArrowLeft, ChevronDown, ChevronRight, ScrollText, Trash2 } from 'lucide-react';
import {
  adminApi,
  getApiErrorMessage,
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AUDIT_RETENTION_DAYS,
  type AuditLogEntry,
  type AuditLogFilters,
} from '@/lib/api';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { isSuperAdmin } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pagination } from '@/components/shared/Pagination';

const PAGE_SIZE = 25;
const ALL = 'ALL';
const TEXT_DEBOUNCE_MS = 350;

type Severity = 'danger' | 'warning';

const SEVERITY: Partial<Record<string, Severity>> = {
  SECURITY_ALERT: 'danger',
  PAYMENT_MISMATCH: 'warning',
};

const QUICK_FILTERS = [
  { action: 'SECURITY_ALERT', label: 'Security alerts' },
  { action: 'PAYMENT_MISMATCH', label: 'Payment mismatches' },
] as const;

const ROW_CLASS: Record<Severity, string> = {
  danger: 'bg-red-50 dark:bg-red-950/30 border-l-4 border-l-red-600',
  warning: 'bg-amber-50 dark:bg-amber-950/30 border-l-4 border-l-amber-500',
};

const BADGE_CLASS: Record<Severity, string> = {
  danger: 'border-red-600 bg-red-600 text-white hover:bg-red-600',
  warning: 'border-amber-500 bg-amber-100 text-amber-900 hover:bg-amber-100 dark:bg-amber-900 dark:text-amber-50',
};

const pickKnown = (value: string | null, known: readonly string[]) =>
  value && known.includes(value) ? value : ALL;

/** `yyyy-mm-dd` (local) → ISO timestamp at the start / end of that local day. */
const dayBoundary = (day: string, end: boolean): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

/** Trailing-edge debounce of a text value. */
function useDebounced(value: string, delay = TEXT_DEBOUNCE_MS) {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const formatJson = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

function AuditTime({ value }: { value: string }) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return <span className="text-muted-foreground">Unknown</span>;
  return (
    <time dateTime={date.toISOString()} className="flex flex-col">
      <span className="whitespace-nowrap">{format(date, 'dd MMM yyyy, HH:mm:ss')}</span>
      <span className="text-xs text-muted-foreground">{formatDistanceToNow(date, { addSuffix: true })}</span>
    </time>
  );
}

function Actor({ entry }: { entry: AuditLogEntry }) {
  if (entry.user) {
    return (
      <div className="flex flex-col min-w-0">
        <span className="font-medium truncate">{entry.user.fullName}</span>
        <span className="text-xs text-muted-foreground truncate">{entry.user.email}</span>
      </div>
    );
  }
  if (entry.userId) {
    return (
      <span className="font-mono text-xs break-all" title="Account not found (it may have been deleted)">
        {entry.userId}
      </span>
    );
  }
  return <span className="text-muted-foreground">System</span>;
}

function ActionBadge({ action }: { action: string }) {
  const severity = SEVERITY[action];
  return (
    <Badge
      variant={severity ? 'default' : 'outline'}
      data-audit-action={action}
      className={cn('font-mono text-[11px] whitespace-nowrap', severity && BADGE_CLASS[severity])}
    >
      {action}
    </Badge>
  );
}

function AuditDetails({
  entry,
  onFilterActor,
  onFilterEntity,
}: {
  entry: AuditLogEntry;
  onFilterActor: (userId: string) => void;
  onFilterEntity: (entityType: string, entityId: string) => void;
}) {
  return (
    <div className="space-y-3" data-testid={`audit-details-${entry.id}`}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">Old values</p>
          <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-80 whitespace-pre-wrap break-all">
            {formatJson(entry.oldValues)}
          </pre>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground mb-1">New values</p>
          <pre className="text-xs bg-muted rounded-md p-3 overflow-x-auto max-h-80 whitespace-pre-wrap break-all">
            {formatJson(entry.newValues)}
          </pre>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>
          Entry id: <span className="font-mono">{entry.id}</span>
        </span>
        {entry.userAgent && <span className="break-all">User agent: {entry.userAgent}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {entry.userId && (
          <Button variant="outline" size="sm" onClick={() => onFilterActor(entry.userId!)}>
            All entries by this actor
          </Button>
        )}
        {entry.entityId && (
          <Button variant="outline" size="sm" onClick={() => onFilterEntity(entry.entityType, entry.entityId!)}>
            History of this {entry.entityType.toLowerCase().replace(/_/g, ' ')}
          </Button>
        )}
      </div>
    </div>
  );
}

function AdminAuditContent() {
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canCleanup = isSuperAdmin(user);

  // Initial filters come from the URL so notification links (e.g. ?action=PAYMENT_MISMATCH) land pre-filtered.
  const [action, setAction] = React.useState(() => pickKnown(searchParams?.get('action') ?? null, AUDIT_ACTIONS));
  const [entityType, setEntityType] = React.useState(() =>
    pickKnown(searchParams?.get('entityType') ?? null, AUDIT_ENTITY_TYPES)
  );
  const [entityIdInput, setEntityIdInput] = React.useState(() => searchParams?.get('entityId')?.trim() ?? '');
  const [userIdInput, setUserIdInput] = React.useState(() => searchParams?.get('userId')?.trim() ?? '');
  const [fromDay, setFromDay] = React.useState('');
  const [toDay, setToDay] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [confirmCleanup, setConfirmCleanup] = React.useState(false);

  const userId = useDebounced(userIdInput.trim());
  const entityId = useDebounced(entityIdInput.trim());

  // Text filters reset paging once their debounced value settles.
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setPage(1);
  }, [userId, entityId]);

  const filters: AuditLogFilters = {
    action: action === ALL ? undefined : action,
    entityType: entityType === ALL ? undefined : entityType,
    entityId: entityId || undefined,
    userId: userId || undefined,
    startDate: dayBoundary(fromDay, false),
    endDate: dayBoundary(toDay, true),
    page,
    limit: PAGE_SIZE,
  };
  const invalidRange = !!filters.startDate && !!filters.endDate && filters.startDate > filters.endDate;

  const logsQuery = useQuery({
    queryKey: ['admin', 'audit', filters],
    queryFn: async () => (await adminApi.getAuditLogs(filters)).data,
    placeholderData: keepPreviousData,
  });

  const cleanupMutation = useMutation({
    mutationFn: () => adminApi.cleanupAuditLogs(AUDIT_RETENTION_DAYS),
    onSuccess: (res) => {
      const deleted = res.data?.deletedCount ?? 0;
      toast({
        title: 'Old audit logs cleaned up',
        description: `${deleted} ${deleted === 1 ? 'entry' : 'entries'} older than ${AUDIT_RETENTION_DAYS} days deleted.`,
      });
      setConfirmCleanup(false);
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError: (err) => {
      toast({
        title: 'Could not clean up audit logs',
        description: getApiErrorMessage(err, 'Please try again.'),
        variant: 'destructive',
      });
    },
  });

  const logs = logsQuery.data?.logs ?? [];
  const pagination = logsQuery.data?.pagination;
  const hasFilters =
    action !== ALL || entityType !== ALL || !!entityIdInput.trim() || !!userIdInput.trim() || !!fromDay || !!toDay;

  const changeFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const clearFilters = () => {
    setAction(ALL);
    setEntityType(ALL);
    setEntityIdInput('');
    setUserIdInput('');
    setFromDay('');
    setToDay('');
    setPage(1);
  };

  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <Button variant="link" asChild className="px-0 h-auto mb-1 text-muted-foreground">
            <Link href="/admin">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Admin dashboard
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">Audit log</h1>
          <p className="text-muted-foreground">
            Who did what, and when: admin actions, security alerts and payment reconciliation issues.
          </p>
        </div>
        {canCleanup && (
          <Button variant="outline" onClick={() => setConfirmCleanup(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clean up old logs
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground mr-1">Quick filters:</span>
            {QUICK_FILTERS.map((chip) => {
              const active = action === chip.action;
              const severity = SEVERITY[chip.action]!;
              return (
                <Button
                  key={chip.action}
                  type="button"
                  size="sm"
                  variant={active ? 'default' : 'outline'}
                  aria-pressed={active}
                  className={cn('rounded-full', active && BADGE_CLASS[severity])}
                  onClick={() => changeFilter(setAction)(active ? ALL : chip.action)}
                >
                  {chip.label}
                </Button>
              );
            })}
          </div>

          <form
            role="search"
            aria-label="Filter audit log"
            onSubmit={(e) => e.preventDefault()}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[180px_180px_1fr_1fr_150px_150px_auto]"
          >
            <Select value={action} onValueChange={changeFilter(setAction)}>
              <SelectTrigger aria-label="Filter by action">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                {AUDIT_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityType} onValueChange={changeFilter(setEntityType)}>
              <SelectTrigger aria-label="Filter by entity type">
                <SelectValue placeholder="Entity type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All entity types</SelectItem>
                {AUDIT_ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label="Entity id"
              placeholder="Entity id"
              value={entityIdInput}
              onChange={(e) => setEntityIdInput(e.target.value)}
            />
            <Input
              aria-label="Actor user id"
              placeholder="Actor user id"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
            />
            <Input
              type="date"
              aria-label="From date"
              value={fromDay}
              max={toDay || undefined}
              onChange={(e) => changeFilter(setFromDay)(e.target.value)}
            />
            <Input
              type="date"
              aria-label="To date"
              value={toDay}
              min={fromDay || undefined}
              onChange={(e) => changeFilter(setToDay)(e.target.value)}
            />
            <Button type="button" variant="ghost" onClick={clearFilters} disabled={!hasFilters}>
              Clear
            </Button>
          </form>
          {invalidRange && (
            <p className="text-sm text-destructive" role="alert">
              The start date is after the end date, so nothing can match.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {logsQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load the audit log</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {getApiErrorMessage(logsQuery.error, 'Please try again.')}
            <Button variant="outline" size="sm" onClick={() => logsQuery.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : logsQuery.isLoading ? (
        <Card>
          <CardContent className="pt-6 space-y-3" aria-label="Loading audit log">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-8 w-36" />
                <Skeleton className="h-8 flex-1" />
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-6 w-32" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ScrollText className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <h3 className="font-semibold">{hasFilters ? 'No audit entries match these filters' : 'No audit entries yet'}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {hasFilters ? 'Try widening the date range or clearing the filters.' : 'Admin and security events will appear here.'}
            </p>
            {hasFilters && (
              <Button variant="outline" className="mt-4" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-2">
                      <span className="sr-only">Details</span>
                    </th>
                    <th scope="col" className="px-3 py-2">Time</th>
                    <th scope="col" className="px-3 py-2">Actor</th>
                    <th scope="col" className="px-3 py-2">Action</th>
                    <th scope="col" className="px-3 py-2">Entity</th>
                    <th scope="col" className="px-3 py-2">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((entry) => {
                    const severity = SEVERITY[entry.action];
                    const isOpen = expanded.has(entry.id);
                    return (
                      <React.Fragment key={entry.id}>
                        <tr
                          data-severity={severity}
                          className={cn('border-b align-top', severity ? ROW_CLASS[severity] : 'hover:bg-muted/30')}
                        >
                          <td className="px-3 py-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              aria-expanded={isOpen}
                              aria-controls={`audit-details-row-${entry.id}`}
                              aria-label={isOpen ? 'Hide details' : 'Show details'}
                              onClick={() => toggleExpanded(entry.id)}
                            >
                              {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </td>
                          <td className="px-3 py-2">
                            <AuditTime value={entry.createdAt} />
                          </td>
                          <td className="px-3 py-2 max-w-[220px]">
                            <Actor entry={entry} />
                          </td>
                          <td className="px-3 py-2">
                            <ActionBadge action={entry.action} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col">
                              <span className="font-medium">{entry.entityType}</span>
                              {entry.entityId && (
                                <span className="font-mono text-xs text-muted-foreground break-all">{entry.entityId}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            {entry.ipAddress || <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr id={`audit-details-row-${entry.id}`} className="border-b bg-muted/20">
                            <td colSpan={6} className="px-4 py-3">
                              <AuditDetails
                                entry={entry}
                                onFilterActor={(id) => {
                                  setUserIdInput(id);
                                  setPage(1);
                                }}
                                onFilterEntity={(type, id) => {
                                  setEntityType(pickKnown(type, AUDIT_ENTITY_TYPES));
                                  setEntityIdInput(id);
                                  setPage(1);
                                }}
                              />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Pagination pagination={pagination} onPageChange={setPage} disabled={logsQuery.isFetching} noun="entries" />

      {canCleanup && (
        <Dialog open={confirmCleanup} onOpenChange={(open) => !cleanupMutation.isPending && setConfirmCleanup(open)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clean up old audit logs?</DialogTitle>
              <DialogDescription>
                Every audit entry older than {AUDIT_RETENTION_DAYS} days will be permanently deleted. Newer entries are
                kept. This cannot be undone, and the cleanup itself is recorded in the audit log.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmCleanup(false)} disabled={cleanupMutation.isPending}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => cleanupMutation.mutate()}
                disabled={cleanupMutation.isPending}
              >
                {cleanupMutation.isPending ? 'Deleting…' : 'Delete old entries'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Admin audit log viewer (PRD §6.10 / §8.4). Access is gated by admin/layout.tsx (ADMIN+). */
export default function AdminAuditPage() {
  return (
    <React.Suspense
      fallback={
        <div className="space-y-3" aria-label="Loading audit log">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <AdminAuditContent />
    </React.Suspense>
  );
}
