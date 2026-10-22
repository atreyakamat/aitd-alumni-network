'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, Flag, Loader2, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { QuotedPost } from '@/components/social/PostCard';
import { RichText } from '@/components/social/RichText';
import { useCursorList, type FetchPage } from '@/hooks/use-cursor-list';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import {
  REPORT_REASON_LABELS,
  REPORT_STATUSES,
  relativeTime,
  socialApi,
  type ContentReport,
  type ReportStatus,
} from '@/lib/social';
import { cn } from '@/lib/utils';

const STATUS_LABELS: Record<ReportStatus, string> = { OPEN: 'Open', RESOLVED: 'Content removed', DISMISSED: 'Dismissed' };

type Action = 'DISMISS' | 'REMOVE_CONTENT';

export default function AdminReportsPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState<ReportStatus>('OPEN');
  const fetchPage = useCallback<FetchPage<ContentReport>>((cursor, signal) => socialApi.adminReports(status, cursor, { signal }), [status]);
  const list = useCursorList<ContentReport>(fetchPage, status, (r) => r.id);
  const [acting, setActing] = useState<{ report: ContentReport; action: Action } | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const resolve = async () => {
    if (!acting) return;
    setSubmitting(true);
    try {
      await socialApi.resolveReport(acting.report.id, { action: acting.action, ...(note.trim() ? { note: note.trim() } : {}) });
      list.remove(acting.report.id);
      toast({
        title: acting.action === 'REMOVE_CONTENT' ? 'Content removed' : 'Report dismissed',
        description: 'The decision is recorded in the audit log.',
      });
      setActing(null);
      setNote('');
    } catch (err) {
      toast({ variant: 'destructive', title: 'Could not resolve the report', description: getApiErrorMessage(err, 'Please try again.') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="mb-2">
          <Link href="/admin"><ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />Admin</Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><ShieldAlert className="h-6 w-6 text-primary" aria-hidden="true" />Reported content</h1>
        <p className="text-sm text-muted-foreground">Reports from members about posts and comments. Reports on the same item are grouped.</p>
      </div>

      <div role="tablist" aria-label="Report status" className="flex gap-1 rounded-lg border bg-card p-1">
        {REPORT_STATUSES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={cn('flex-1 rounded-md px-3 py-1.5 text-sm font-medium', status === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {list.loading ? (
        <div className="space-y-4" aria-label="Loading reports">{[0, 1].map((i) => <Skeleton key={i} className="h-48 w-full" />)}</div>
      ) : list.error ? (
        <Card><CardContent className="flex flex-col items-center gap-3 py-10">
          <p role="alert" className="text-sm text-destructive">{list.error}</p>
          <Button variant="outline" onClick={list.reload}>Try again</Button>
        </CardContent></Card>
      ) : list.items.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600" aria-hidden="true" />
          <p className="font-semibold">{status === 'OPEN' ? 'No open reports' : `No ${STATUS_LABELS[status].toLowerCase()} reports`}</p>
          {status === 'OPEN' && <p className="text-sm text-muted-foreground">The community is behaving. Nothing needs your attention.</p>}
        </CardContent></Card>
      ) : (
        <ul className="space-y-4">
          {list.items.map((report) => (
            <li key={report.id}>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Flag className="h-4 w-4 text-destructive" aria-hidden="true" />
                    {REPORT_REASON_LABELS[report.reason]}
                    <Badge variant="secondary">{report.comment ? 'Comment' : 'Post'}</Badge>
                    {report.reportCount > 1 && <Badge variant="destructive">{report.reportCount} reports</Badge>}
                    <span className="ml-auto text-xs font-normal text-muted-foreground">{relativeTime(report.createdAt)}</span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Reported by {report.reporter ? (
                      <Link href={`/profile/${encodeURIComponent(report.reporter.id)}`} className="font-medium text-foreground hover:underline">{report.reporter.fullName}</Link>
                    ) : 'a member'}
                    {report.details && <>: “{report.details}”</>}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {report.comment ? (
                    <div className="rounded-lg border p-3">
                      <p className="mb-1 text-sm font-semibold">{report.comment.user.fullName}</p>
                      <RichText text={report.comment.content} mentions={report.comment.mentions} />
                      {report.comment.postId && (
                        <Link href={`/posts/${encodeURIComponent(report.comment.postId)}#comment-${encodeURIComponent(report.comment.id)}`} className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                          View in context<ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      )}
                    </div>
                  ) : report.post ? (
                    <div className="space-y-1">
                      <QuotedPost post={report.post} />
                      <Link href={`/posts/${encodeURIComponent(report.post.id)}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        Open post<ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">The reported content no longer exists.</p>
                  )}

                  {report.status === 'OPEN' ? (
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setNote(''); setActing({ report, action: 'DISMISS' }); }}>
                        <XCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />Dismiss
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => { setNote(''); setActing({ report, action: 'REMOVE_CONTENT' }); }} disabled={!report.post && !report.comment}>
                        <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Remove content
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {STATUS_LABELS[report.status]}
                      {report.resolvedBy && <> by {report.resolvedBy.fullName}</>}
                      {report.resolvedAt && <> · {relativeTime(report.resolvedAt)}</>}
                      {report.resolution && <> · “{report.resolution}”</>}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {list.hasMore && !list.loading && (
        <div className="flex justify-center">
          <Button variant="ghost" onClick={list.loadMore} disabled={list.loadingMore}>
            {list.loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}Load more
          </Button>
        </div>
      )}

      <Dialog open={acting !== null} onOpenChange={(o) => !submitting && !o && setActing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{acting?.action === 'REMOVE_CONTENT' ? 'Remove this content?' : 'Dismiss this report?'}</DialogTitle>
            <DialogDescription>
              {acting?.action === 'REMOVE_CONTENT'
                ? 'The post or comment is deleted for everyone and every open report on it is resolved.'
                : 'The content stays up. Other open reports on it remain open.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="report-note">Note for the audit log <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="report-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-[72px] resize-none" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setActing(null)} disabled={submitting}>Cancel</Button>
            <Button variant={acting?.action === 'REMOVE_CONTENT' ? 'destructive' : 'default'} onClick={resolve} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              {acting?.action === 'REMOVE_CONTENT' ? 'Remove content' : 'Dismiss report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
