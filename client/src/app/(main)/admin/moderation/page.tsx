'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Loader2,
  MapPin,
  XCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { adminApi, getApiErrorMessage, jobApi, type PendingJob } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pagination } from '@/components/shared/Pagination';

const PAGE_SIZE = 10;
const MIN_REJECT_REASON = 5;

const humanize = (value?: unknown) =>
  typeof value === 'string' && value
    ? value
        .toLowerCase()
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ')
    : null;

export default function AdminModerationPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [rejecting, setRejecting] = React.useState<PendingJob | null>(null);
  const [reason, setReason] = React.useState('');
  const [actingId, setActingId] = React.useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ['admin', 'pending-jobs', page],
    queryFn: async () => (await adminApi.getPendingJobs({ page, limit: PAGE_SIZE })).data,
    placeholderData: keepPreviousData,
  });

  const afterDecision = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'pending-jobs'] });
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };

  // If the last item on a page was moderated, step back a page.
  React.useEffect(() => {
    const p = jobsQuery.data?.pagination;
    if (p && page > 1 && (jobsQuery.data?.data.length ?? 0) === 0) {
      setPage(Math.max(1, p.totalPages));
    }
  }, [jobsQuery.data, page]);

  const approveMutation = useMutation({
    mutationFn: (job: PendingJob) => jobApi.approveJob(job.id),
    onMutate: (job) => setActingId(job.id),
    onSuccess: (_res, job) => {
      toast({ title: 'Job approved', description: `"${job.title}" is now live.` });
      afterDecision();
    },
    onError: (err) =>
      toast({ title: 'Could not approve job', description: getApiErrorMessage(err, 'Please try again.'), variant: 'destructive' }),
    onSettled: () => setActingId(null),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ job, reason }: { job: PendingJob; reason: string }) => jobApi.rejectJob(job.id, reason),
    onMutate: ({ job }) => setActingId(job.id),
    onSuccess: (_res, { job }) => {
      toast({ title: 'Job rejected', description: `The poster of "${job.title}" has been notified.` });
      setRejecting(null);
      afterDecision();
    },
    onError: (err) =>
      toast({ title: 'Could not reject job', description: getApiErrorMessage(err, 'Please try again.'), variant: 'destructive' }),
    onSettled: () => setActingId(null),
  });

  const jobs = jobsQuery.data?.data ?? [];
  const total = jobsQuery.data?.pagination?.total;
  const reasonValid = reason.trim().length >= MIN_REJECT_REASON;
  const busy = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="link" asChild className="px-0 h-auto mb-1 text-muted-foreground">
          <Link href="/admin">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Admin dashboard
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Moderation queue</h1>
          {typeof total === 'number' && total > 0 && <Badge variant="warning">{total} pending</Badge>}
        </div>
        <p className="text-muted-foreground">Review job postings before they are published to members.</p>
      </div>

      {jobsQuery.isError ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Could not load the moderation queue</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            {getApiErrorMessage(jobsQuery.error, 'Please try again.')}
            <Button variant="outline" size="sm" onClick={() => jobsQuery.refetch()}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : jobsQuery.isLoading ? (
        <div className="space-y-4" aria-label="Loading pending jobs">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6 space-y-3">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-4 w-1/4" />
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ClipboardCheck className="h-10 w-10 mx-auto text-green-600 mb-3" />
            <h3 className="font-semibold">All caught up</h3>
            <p className="text-sm text-muted-foreground mt-1">No job postings are waiting for review.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const company = (job.company as string) || (job.companyName as string) || 'Company not specified';
            const jobType = humanize(job.jobType ?? job.type);
            const workplace = humanize(job.workplaceType);
            const link = typeof job.applicationLink === 'string' ? job.applicationLink : null;
            const acting = actingId === job.id;
            return (
              <Card key={job.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-primary shrink-0" />
                        <span className="truncate">{job.title}</span>
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3.5 w-3.5" /> {company}
                        </span>
                        {job.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" /> {job.location}
                          </span>
                        )}
                        <span>Submitted {formatDate(job.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {jobType && <Badge variant="secondary">{jobType}</Badge>}
                      {workplace && <Badge variant="outline">{workplace}</Badge>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {job.description && (
                    <p className="text-sm whitespace-pre-line line-clamp-4">{job.description}</p>
                  )}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t pt-4">
                    <div className="text-sm text-muted-foreground">
                      Posted by{' '}
                      {job.postedBy ? (
                        <Link href={`/profile/${job.postedBy.id}`} className="font-medium text-foreground hover:underline">
                          {job.postedBy.fullName}
                        </Link>
                      ) : (
                        'unknown user'
                      )}
                      {job.postedBy?.email ? ` · ${job.postedBy.email}` : ''}
                      {link && (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="ml-3 inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Application link <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setReason('');
                          setRejecting(job);
                        }}
                        disabled={busy}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Reject
                      </Button>
                      <Button onClick={() => approveMutation.mutate(job)} disabled={busy}>
                        {acting && approveMutation.isPending ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                        )}
                        Approve
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <Pagination
            pagination={jobsQuery.data?.pagination}
            onPageChange={setPage}
            disabled={jobsQuery.isFetching}
            noun="pending jobs"
          />
        </div>
      )}

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && !rejectMutation.isPending && setRejecting(null)}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (rejecting && reasonValid) rejectMutation.mutate({ job: rejecting, reason: reason.trim() });
            }}
          >
            <DialogHeader>
              <DialogTitle>Reject “{rejecting?.title}”?</DialogTitle>
              <DialogDescription>
                The poster will be notified with your reason so they can fix and resubmit.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="reject-reason">Reason</Label>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Missing salary range and application link"
                rows={3}
                maxLength={1000}
              />
              <p className="text-xs text-muted-foreground">Required, at least {MIN_REJECT_REASON} characters.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejecting(null)} disabled={rejectMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!reasonValid || rejectMutation.isPending}>
                {rejectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Reject job
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
