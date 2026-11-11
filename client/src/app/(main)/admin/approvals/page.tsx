'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Search, UserCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  adminApi,
  getApiErrorCode,
  getApiErrorMessage,
  type ApprovalStatus,
  type RegistrationApplication,
} from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/shared/Pagination';
import { RegistrationCard } from '@/components/admin/RegistrationCard';
import { ApproveRegistrationDialog, RejectRegistrationDialog } from '@/components/admin/ApprovalDialogs';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { APPROVALS_CHANGED_EVENT } from '@/hooks/use-pending-approvals';

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

const pickStatus = (value: string | null | undefined): ApprovalStatus =>
  TABS.some((tab) => tab.status === value) ? (value as ApprovalStatus) : 'PENDING';

function AdminApprovalsContent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  // Links from other admin pages (/admin/approvals?status=REJECTED&search=<e-mail>) open the right tab, filtered to one person
  const [status, setStatus] = React.useState<ApprovalStatus>(() => pickStatus(searchParams?.get('status')));
  const [searchInput, setSearchInput] = React.useState(() => searchParams?.get('search')?.trim() ?? '');
  const [search, setSearch] = React.useState(() => searchParams?.get('search')?.trim() ?? '');
  const [page, setPage] = React.useState(1);

  const [approving, setApproving] = React.useState<RegistrationApplication | null>(null);
  const [rejecting, setRejecting] = React.useState<RegistrationApplication | null>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);

  // Debounce free-text search.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const filters = { status, search: search || undefined, page, limit: PAGE_SIZE };

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

  const busy = approveMutation.isPending || rejectMutation.isPending;
  const rows = listQuery.data?.data ?? [];
  const pagination = listQuery.data?.pagination;

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

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Registration approvals"
        icon={UserCheck}
        description="Check that each applicant is an alumnus of the college, then approve or reject the registration. Nobody can sign in before an administrator has approved it."
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

      <Card>
        <CardContent className="pt-6">
          <form role="search" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}>
            <div className="relative max-w-md">
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
          </form>
        </CardContent>
      </Card>

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
            <h3 className="font-semibold">{search ? 'No registrations match this search' : EMPTY_TEXT[status]}</h3>
            {search && <p className="mt-1 text-sm text-muted-foreground">Try a different name, e-mail or enrolment number.</p>}
          </CardContent>
        </Card>
      ) : (
        <div className={listQuery.isFetching ? 'space-y-4 opacity-60 transition-opacity' : 'space-y-4'}>
          {rows.map((application) => (
            <RegistrationCard
              key={application.id}
              application={application}
              busy={busy}
              onApprove={openApprove}
              onReject={openReject}
            />
          ))}
        </div>
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
