'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** Mirrors the server (memberApprovalService): a note is optional, a rejection needs a reason of 3 to 500 characters. */
export const APPROVAL_NOTE_MAX = 500;
export const REJECTION_REASON_MIN = 3;
export const REJECTION_REASON_MAX = 500;

interface DialogProps {
  /** The registration being decided, or null while the dialog is closed. */
  name: string | null;
  pending: boolean;
  /** The message of the server when the last attempt failed (for example EMAIL_NOT_VERIFIED). */
  error: string | null;
  onConfirm: (text: string) => void;
  onClose: () => void;
}

/** The name stays on screen while the dialog fades out, instead of flashing "Approve ?". */
function useLastName(name: string | null): string {
  const last = React.useRef('');
  if (name) last.current = name;
  return name ?? last.current;
}

/** Approve: the note is optional and kept in the audit trail. */
export function ApproveRegistrationDialog({ name, pending, error, onConfirm, onClose }: DialogProps) {
  const [note, setNote] = React.useState('');
  const open = name !== null;
  const shownName = useLastName(name);

  React.useEffect(() => {
    if (open) setNote('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) onConfirm(note.trim());
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{`Approve ${shownName}?`}</DialogTitle>
            <DialogDescription>
              They can sign in right away, and are told by e-mail. Check first that this person is an alumnus of the college.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="approval-note">
              Note <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="approval-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Checked against the 2019 batch list"
              rows={3}
              maxLength={APPROVAL_NOTE_MAX}
              disabled={pending}
            />
            <p className="text-right text-xs text-muted-foreground" aria-live="polite">
              {note.length} / {APPROVAL_NOTE_MAX}
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pending ? 'Approving...' : 'Approve'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reject: the reason is required and is e-mailed to the applicant, so it is validated before anything is sent. */
export function RejectRegistrationDialog({ name, pending, error, onConfirm, onClose }: DialogProps) {
  const [reason, setReason] = React.useState('');
  const [invalid, setInvalid] = React.useState(false);
  const open = name !== null;
  const shownName = useLastName(name);

  React.useEffect(() => {
    if (open) {
      setReason('');
      setInvalid(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= REJECTION_REASON_MIN && trimmed.length <= REJECTION_REASON_MAX;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (pending) return;
            if (!valid) {
              setInvalid(true);
              return;
            }
            onConfirm(trimmed);
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{`Reject ${shownName}?`}</DialogTitle>
            <DialogDescription>
              They will not be able to sign in. You can still approve the registration later if you change your mind.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="rejection-reason">Reason</Label>
            <Textarea
              id="rejection-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setInvalid(false);
              }}
              placeholder="e.g. We could not find this name on the batch list"
              rows={3}
              maxLength={REJECTION_REASON_MAX}
              aria-invalid={invalid || undefined}
              required
              disabled={pending}
            />
            <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
              <span>
                Required, {REJECTION_REASON_MIN} to {REJECTION_REASON_MAX} characters. The applicant receives this reason by e-mail,
                so write it for them.
              </span>
              <span className="shrink-0" aria-live="polite">
                {reason.length} / {REJECTION_REASON_MAX}
              </span>
            </div>
          </div>

          {(invalid || error) && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {invalid
                ? `Give a reason of ${REJECTION_REASON_MIN} to ${REJECTION_REASON_MAX} characters: the applicant is told why.`
                : error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pending ? 'Rejecting...' : 'Reject registration'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
