'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { REPORT_DETAILS_MAX, REPORT_REASONS, REPORT_REASON_LABELS, socialApi, type ReportReason } from '@/lib/social';
import { cn } from '@/lib/utils';

/** Report a post or a comment to the moderators. */
export function ReportDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { kind: 'post' | 'comment'; id: string };
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason(null);
      setDetails('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    if (!reason || submitting) return;
    setSubmitting(true);
    setError(null);
    const input = { reason, ...(details.trim() ? { details: details.trim() } : {}) };
    try {
      if (target.kind === 'post') await socialApi.reportPost(target.id, input);
      else await socialApi.reportComment(target.id, input);
      toast({ title: 'Thanks for letting us know', description: 'Our moderators will review this.' });
      onOpenChange(false);
    } catch (err) {
      if (getApiErrorCode(err) === 'ALREADY_REPORTED') {
        toast({ title: 'Already reported', description: 'You have an open report on this; moderators will review it.' });
        onOpenChange(false);
      } else {
        setError(getApiErrorMessage(err, 'Could not send the report. Please try again.'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report this {target.kind}</DialogTitle>
          <DialogDescription>Reports are anonymous to the author. Pick the reason that fits best.</DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="sr-only">Reason</legend>
          {REPORT_REASONS.map((r) => (
            <label
              key={r}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted',
                reason === r && 'border-primary bg-primary/5'
              )}
            >
              <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-primary" />
              {REPORT_REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        <div className="space-y-1">
          <label htmlFor="report-details" className="text-sm font-medium">
            Details <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <Textarea
            id="report-details"
            value={details}
            maxLength={REPORT_DETAILS_MAX}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Anything that helps the moderators"
            className="min-h-[72px] resize-none"
          />
          <p className="text-right text-xs text-muted-foreground">
            {details.length}/{REPORT_DETAILS_MAX}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!reason || submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Submit report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
