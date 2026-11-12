'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ListChecks, Search, UserCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  adminApi,
  getApiErrorCode,
  getApiErrorMessage,
  type ApprovalMatchLevel,
  type ApprovalStatus,
  type BulkDecisionResult,
  type RegistrationApplication,
} from '@/lib/api';
import { DEPARTMENTS } from '@/lib/departments';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/shared/Pagination';
import { RegistrationCard, OVERDUE_DAYS, matchLabel } from '@/components/admin/RegistrationCard';
import { ApproveRegistrationDialog, RejectRegistrationDialog } from '@/components/admin/ApprovalDialogs';
import { BulkApproveDialog, BulkRejectDialog, type BulkPerson } from '@/components/admin/BulkDecisionDialogs';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { APPROVALS_CHANGED_EVENT } from '@/hooks/use-pending-approvals';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const TABS: { status: ApprovalStatus; label: string; countKey: 'pending' | 'rejected' | 'approved' }[] = [
  { status: 'PENDING', label: 'Pending', countKey: 'pending' },
  { status: 'REJECTED', label: 'Rejected', countKey: 'rejected' },
  { status: 'APPROVED', label: 'Approved', countKey: 'approved' },
];

const EMPTY_TEXT: Record<ApprovalStatus, string> = {
  PENDING: 'No registrations are waiting for approval.',
  REJECTED: 'No registrations have been rejected.',
  APPROVED: 'No registrations have been approved yet.',
};

/** Codes that mean "somebody else got there first": the list on screen is stale and must be loaded again. */
const STALE_CODES = new Set(['ALREADY_APPROVED', 'NOT_PENDING', 'NOT_FOUND']);

const MATCH_OPTIONS: ApprovalMatchLevel[] = ['exact', 'probable', 'none'];

/** "Waiting more than N days": the server compares with the day the application came in. */
const WAITING_OPTIONS: { value: string; label: string }[] = [
  { value: '3', label: 'More than 3 days' },
  { value: String(OVERDUE_DAYS), label: `${OVERDUE_DAYS} days or more (overdue)` },
  { value: '14', label: 'More than 14 days' },
];

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50';

const pickStatus = (value: string | null | undefined): ApprovalStatus =>
  TABS.some((tab) => tab.status === value) ? (value as ApprovalStatus) : 'PENDING';

/** What the reviewer sees after a bulk decision: what worked and, by name, what did not and why. */
interface BulkOutcome {
  title: string;
  failures: { id: string; name: string; message: string }[];
}

const describeOutcome = (verb: 'Approved' | 'Rejected', result: BulkDecisionResult, people: BulkPerson[]): BulkOutcome => {
  const names = new Map(people.map((p) => [p.id, p.fullName]));
  const total = result.results.length;
  return {
    title: result.failed === 0 ? `${verb} ${result.succeeded} of ${total} registrations` : `${verb} ${result.succeeded} of ${total}: ${result.failed} could not be decided`,
    failures: result.results.flatMap((r) => (r.ok ? [] : [{ id: r.id, name: names.get(r.id) ?? 'A registration', message: r.message }])),
  };
};

function AdminApprovalsContent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  // Links from other admin pages (/admin/approvals?status=REJECTED&search=<e-mail>) open the right tab, filtered to one person
  const [status, setStatus] = React.useState<ApprovalStatus>(() => pickStatus(searchParams?.get('status')));
  const [searchInput, setSearchInput] = React.useState(() => searchParams?.get('search')?.trim() ?? '');
  const [search, setSearch] = React.useState(() => searchParams?.get('search')?.trim() ?? '');
  const [page, setPage] = React.useState(1);

  // Queue helpers
  const [batchInput, setBatchInput] = React.useState('');
  const [batchYear, setBatchYear] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [match, setMatch] = React.useState<'' | ApprovalMatchLevel>('');
  const [waiting, setWaiting] = React.useState('');

  const [approving, setApproving] = React.useState<RegistrationApplication | null>(null);
  const [rejecting, setRejecting] = React.useState<RegistrationApplication | null>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());
  const [bulkApproving, setBulkApproving] = React.useState<BulkPerson[] | null>(null);
  const [bulkRejecting, setBulkRejecting] = React.useState<BulkPerson[] | null>(null);
  const [bulkError, setBulkError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<BulkOutcome | null>(null);

  // Debounce free-text search and the batch year.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setBatchYear(batchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, batchInput]);

  const batchValid = /^\d{4}$/.test(batchYear);
  const filters = {
    status,
    search: search || undefined,
    page,
    limit: PAGE_SIZE,
    batchYear: batchValid ? Number(batchYear) : undefined,
    department: department || undefined,
    match: match || undefined,
    waitingDays: waiting ? Number(waiting) : undefined,
  };
  const filtered = !!(search || batchValid || department || match || waiting);
  const onlySearch = !!search && !(batchValid || department || match || waiting);

  // A selection belongs to the list it was made on
  const filterKey = JSON.stringify(filters);
  React.useEffect(() => {
    setSelected(new Set());
  }, [filterKey]);

  const listQuery = useQuery({
    queryKey: ['admin', 'approvals', 'list', filters],
    queryFn: async () => (await adminApi.listApprovals(filters)).data,
    placeholderData: keepPreviousData,
  });

  // The counts are a nicety: if they cannot be loaded the page works without them
  const summaryQuery = useQuery({
    queryKey: ['admin', 'approvals', 'summary'],
    queryFn: async () => (await adminApi.approvalSummary()).data.data,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'approvals'] });
    // the pending count in the navigation follows
    window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT));
  };

  const onDecisionError = (err: unknown, title: string, fallback: string) => {
    const message = getApiErrorMessage(err, fallback);
    setDialogError(message);
    toast({ variant: 'destructive', title, description: message });
    const code = getApiErrorCode(err);
    if (code && STALE_CODES.has(code)) refresh();
  };

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => adminApi.approveRegistration(id, note),
    onSuccess: () => {
      toast({
        title: 'Registration approved',
        description: `${approving?.fullName ?? 'The applicant'} can sign in now and has been told by e-mail.`,
      });
      setApproving(null);
      refresh();
    },
    onError: (err) => onDecisionError(err, 'Could not approve', 'Could not approve this registration. Please try again.'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.rejectRegistration(id, reason),
    onSuccess: () => {
      toast({
        title: 'Registration rejected',
        description: `${rejecting?.fullName ?? 'The applicant'} has been told the reason by e-mail.`,
      });
      setRejecting(null);
      refresh();
    },
    onError: (err) => onDecisionError(err, 'Could not reject', 'Could not reject this registration. Please try again.'),
  });

  const finishBulk = (verb: 'Approved' | 'Rejected', result: BulkDecisionResult, people: BulkPerson[]) => {
    const next = describeOutcome(verb, result, people);
    setOutcome(next);
    setSelected(new Set());
    toast({ title: next.title, variant: result.succeeded === 0 ? 'destructive' : undefined });
    refresh();
  };

  const bulkApproveMutation = useMutation({
    mutationFn: ({ people, note }: { people: BulkPerson[]; note: string }) =>
      adminApi.bulkApproveRegistrations(people.map((p) => p.id), note),
    onSuccess: (response, { people }) => {
      setBulkApproving(null);
      finishBulk('Approved', response.data.data, people);
    },
    onError: (err) => {
      const message = getApiErrorMessage(err, 'Could not approve these registrations. Please try again.');
      setBulkError(message);
      toast({ variant: 'destructive', title: 'Could not approve', description: message });
    },
  });

  const bulkRejectMutation = useMutation({
    mutationFn: ({ people, reason }: { people: BulkPerson[]; reason: string }) =>
      adminApi.bulkRejectRegistrations(people.map((p) => p.id), reason),
    onSuccess: (response, { people }) => {
      setBulkRejecting(null);
      finishBulk('Rejected', response.data.data, people);
    },
    onError: (err) => {
      const message = getApiErrorMessage(err, 'Could not reject these registrations. Please try again.');
      setBulkError(message);
      toast({ variant: 'destructive', title: 'Could not reject', description: message });
    },
  });

  const busy =
    approveMutation.isPending || rejectMutation.isPending || bulkApproveMutation.isPending || bulkRejectMutation.isPending;
  const rows = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination;

  // Bulk actions work on the waiting registrations of the page on screen
  const bulkAvailable = status === 'PENDING' && rows.length > 0;
  const selectedRows = rows.filter((r) => selected.has(r.id));
  // SAFEST: a bulk approval is only for rows that match the college list exactly AND whose e-mail address is verified
  const isSafeToBulkApprove = (r: RegistrationApplication) =>
    r.approvalStatus === 'PENDING' && r.match?.level === 'exact' && !!r.emailVerifiedAt;
  const exactRows = rows.filter(isSafeToBulkApprove);
  const selectedAreSafe = selectedRows.length > 0 && selectedRows.every(isSafeToBulkApprove);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const selectAllRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedRows.length > 0 && !allSelected;
  }, [selectedRows.length, allSelected]);

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const people = (list: RegistrationApplication[]): BulkPerson[] => list.map((r) => ({ id: r.id, fullName: r.fullName }));
  const openBulkApprove = (list: RegistrationApplication[]) => {
    setBulkError(null);
    setBulkApproving(people(list));
  };
  const openBulkReject = (list: RegistrationApplication[]) => {
    setBulkError(null);
    setBulkRejecting(people(list));
  };

  const openApprove = (application: RegistrationApplication) => {
    setDialogError(null);
    setApproving(application);
  };
  const openReject = (application: RegistrationApplication) => {
    setDialogError(null);
    setRejecting(application);
  };

  const changeStatus = (next: string) => {
    setStatus(next as ApprovalStatus);
    setPage(1);
  };

  const changeFilter = (setter: (value: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setBatchInput('');
    setBatchYear('');
    setDepartment('');
    setMatch('');
    setWaiting('');
    setPage(1);
  };

  const overdue = summaryQuery.data?.overdue ?? 0;
  const listIsEmpty = summaryQuery.data?.alumniRecords === 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Registration approvals"
        icon={UserCheck}
        description="Check that each applicant is an alumnus of the college, then approve or reject the registration. Nobody can sign in before an administrator has approved it."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/alumni-list">
              <ListChecks className="mr-1 h-4 w-4" aria-hidden="true" /> College alumni list
            </Link>
          </Button>
        }
      />

      <Tabs value={status} onValueChange={changeStatus}>
        <TabsList className="h-auto flex-wrap">
          {TABS.map((tab) => {
            const count = summaryQuery.data?.[tab.countKey];
            return (
              <TabsTrigger key={tab.status} value={tab.status} className="gap-2">
                {tab.label}
                {typeof count === 'number' && (
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold text-foreground">{count}</span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {status === 'PENDING' && overdue > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-2 text-sm font-medium text-destructive">
          {overdue === 1 ? '1 application has' : `${overdue} applications have`} waited {OVERDUE_DAYS} days or more.
          {waiting !== String(OVERDUE_DAYS) && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => {
                setWaiting(String(OVERDUE_DAYS));
                setPage(1);
              }}
            >
              Show them
            </Button>
          )}
        </p>
      )}

      {listIsEmpty && (
        <Alert role="note">
          <ListChecks className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>The college alumni list has not been imported yet</AlertTitle>
          <AlertDescription>
            Import the list the college keeps and every registration shows whether the person is on it.{' '}
            <Link href="/admin/alumni-list" className="font-medium underline underline-offset-2">
              Import the list
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <form
            role="search"
            aria-label="Filter registrations"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
              setBatchYear(batchInput.trim());
              setPage(1);
            }}
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                aria-label="Search registrations"
                placeholder="Search by name, e-mail or enrolment number"
                className="pl-9"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={4}
              aria-label="Filter by batch year"
              placeholder="Batch"
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value.replace(/\D/g, ''))}
            />
            <select aria-label="Filter by department" className={selectClass} value={department} onChange={changeFilter(setDepartment)}>
              <option value="">All departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by match with the college list"
              className={selectClass}
              value={match}
              onChange={changeFilter((v) => setMatch(v as '' | ApprovalMatchLevel))}
            >
              <option value="">Any match</option>
              {MATCH_OPTIONS.map((level) => (
                <option key={level} value={level}>
                  {matchLabel(level)}
                </option>
              ))}
            </select>
            <select aria-label="Filter by waiting time" className={selectClass} value={waiting} onChange={changeFilter(setWaiting)}>
              <option value="">Any waiting time</option>
              {WAITING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  Waiting {o.label.toLowerCase()}
                </option>
              ))}
            </select>
            {filtered && (
              <Button type="button" variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      {outcome && (
        <Alert role="status" variant={outcome.failures.length > 0 ? 'destructive' : 'default'}>
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>{outcome.title}</AlertTitle>
          <AlertDescription className="space-y-2">
            {outcome.failures.length > 0 && (
              <ul className="list-disc pl-5">
                {outcome.failures.map((f) => (
                  <li key={f.id}>
                    <span className="font-medium">{f.name}</span>: {f.message}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" onClick={() => setOutcome(null)}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {listQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load registrations</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {getApiErrorMessage(listQuery.error, 'Please try again.')}
            <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : listQuery.isLoading ? (
        <div className="space-y-4" aria-label="Loading registrations">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="space-y-3 pt-6">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="font-semibold">{filtered ? (onlySearch ? 'No registrations match this search' : 'No registrations match these filters') : EMPTY_TEXT[status]}</h3>
            {filtered && <p className="mt-1 text-sm text-muted-foreground">Try a different name, e-mail, enrolment number or filter.</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          {bulkAvailable && (
            <section aria-label="Bulk actions" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  checked={allSelected}
                  disabled={busy}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
                Select all on this page
              </label>
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {selectedRows.length === 0 ? 'None selected' : `${selectedRows.length} selected`}
              </span>
              {selectedRows.length > 0 && (
                <>
                  <Button size="sm" onClick={() => openBulkApprove(selectedRows)} disabled={busy || !selectedAreSafe}>
                    Approve selected
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openBulkReject(selectedRows)} disabled={busy}>
                    Reject selected
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>
                    Clear selection
                  </Button>
                </>
              )}
              {exactRows.length > 0 && (
                <Button size="sm" variant="secondary" onClick={() => openBulkApprove(exactRows)} disabled={busy} className="ml-auto">
                  Approve all exact matches on this page ({exactRows.length})
                </Button>
              )}
              {selectedRows.length > 0 && !selectedAreSafe && (
                <p className="basis-full text-xs text-muted-foreground">
                  Only registrations that match the college list exactly and have a verified e-mail address can be approved together.
                  Check the others and approve them one by one.
                </p>
              )}
            </section>
          )}

          <div className={cn('space-y-4', listQuery.isFetching && 'opacity-60 transition-opacity')}>
            {rows.map((application) => (
              <RegistrationCard
                key={application.id}
                application={application}
                busy={busy}
                onApprove={openApprove}
                onReject={openReject}
                selected={selected.has(application.id)}
                onSelectedChange={application.approvalStatus === 'PENDING' ? (checked) => toggle(application.id, checked) : undefined}
              />
            ))}
          </div>
        </>
      )}

      {!listQuery.isError && rows.length > 0 && (
        <Pagination pagination={pagination} onPageChange={setPage} disabled={listQuery.isFetching} noun="registrations" />
      )}

      <ApproveRegistrationDialog
        name={approving?.fullName ?? null}
        pending={approveMutation.isPending}
        error={dialogError}
        onClose={() => setApproving(null)}
        onConfirm={(note) => approving && approveMutation.mutate({ id: approving.id, note })}
      />
      <RejectRegistrationDialog
        name={rejecting?.fullName ?? null}
        pending={rejectMutation.isPending}
        error={dialogError}
        onClose={() => setRejecting(null)}
        onConfirm={(reason) => rejecting && rejectMutation.mutate({ id: rejecting.id, reason })}
      />
      <BulkApproveDialog
        people={bulkApproving}
        pending={bulkApproveMutation.isPending}
        error={bulkError}
        onClose={() => setBulkApproving(null)}
        onConfirm={(note) => bulkApproving && bulkApproveMutation.mutate({ people: bulkApproving, note })}
      />
      <BulkRejectDialog
        people={bulkRejecting}
        pending={bulkRejectMutation.isPending}
        error={bulkError}
        onClose={() => setBulkRejecting(null)}
        onConfirm={(reason) => bulkRejecting && bulkRejectMutation.mutate({ people: bulkRejecting, reason })}
      />
    </div>
  );
}

/** Registration review. Access is gated by admin/layout.tsx (ADMIN+). */
export default function AdminApprovalsPage() {
  return (
    <React.Suspense
      fallback={
        <div className="space-y-4" aria-label="Loading registrations">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      }
    >
      <AdminApprovalsContent />
    </React.Suspense>
  );
}
