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
import { APPROVAL_NOTE_MAX, REJECTION_REASON_MAX, REJECTION_REASON_MIN } from '@/components/admin/ApprovalDialogs';

export interface BulkPerson {
  id: string;
  fullName: string;
}

interface BulkDialogProps {
  /** The people the decision is about, or null while the dialog is closed. */
  people: BulkPerson[] | null;
  pending: boolean;
  /** The message of the server when the last attempt failed as a whole. */
  error: string | null;
  onConfirm: (text: string) => void;
  onClose: () => void;
}

/** The list stays on screen while the dialog fades out. */
function useLastPeople(people: BulkPerson[] | null): BulkPerson[] {
  const last = React.useRef<BulkPerson[]>([]);
  if (people) last.current = people;
  return people ?? last.current;
}

const countOf = (n: number) => `${n} ${n === 1 ? 'registration' : 'registrations'}`;

/** The names are what the reviewer confirms: they are listed, as text, before anything is sent. */
function NameList({ people, id }: { people: BulkPerson[]; id: string }) {
  return (
    <div className="space-y-1">
      <p id={`${id}-label`} className="text-sm font-medium">
        {countOf(people.length)}
      </p>
      <ul aria-labelledby={`${id}-label`} className="max-h-48 list-disc space-y-0.5 overflow-y-auto rounded-md border bg-muted/30 py-2 pl-8 pr-3 text-sm">
        {people.map((p) => (
          <li key={p.id} className="break-words">
            {p.fullName}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Approve several registrations at once. Only offered for registrations that match the college list exactly and whose
 * e-mail address is verified; the dialog lists every name, so nothing is approved that the reviewer has not seen.
 */
export function BulkApproveDialog({ people, pending, error, onConfirm, onClose }: BulkDialogProps) {
  const [note, setNote] = React.useState('');
  const open = people !== null;
  const shown = useLastPeople(people);

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
            <DialogTitle>{`Approve ${countOf(shown.length)}?`}</DialogTitle>
            <DialogDescription>
              Each of them matches the college alumni list and has a verified e-mail address. They can sign in right away and are told by
              e-mail.
            </DialogDescription>
          </DialogHeader>

          <NameList people={shown} id="bulk-approve" />

          <div className="space-y-2">
            <Label htmlFor="bulk-approval-note">
              Note <span className="text-muted-foreground">(optional, kept with every decision)</span>
            </Label>
            <Textarea
              id="bulk-approval-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Matched the college list"
              rows={2}
              maxLength={APPROVAL_NOTE_MAX}
              disabled={pending}
            />
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
            <Button type="submit" disabled={pending || shown.length === 0}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pending ? 'Approving...' : `Approve ${shown.length}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Reject several registrations at once. The reason is always required: every person is told why by e-mail. */
export function BulkRejectDialog({ people, pending, error, onConfirm, onClose }: BulkDialogProps) {
  const [reason, setReason] = React.useState('');
  const [invalid, setInvalid] = React.useState(false);
  const open = people !== null;
  const shown = useLastPeople(people);

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
            <DialogTitle>{`Reject ${countOf(shown.length)}?`}</DialogTitle>
            <DialogDescription>
              They will not be able to sign in. You can still approve a registration later if you change your mind.
            </DialogDescription>
          </DialogHeader>

          <NameList people={shown} id="bulk-reject" />

          <div className="space-y-2">
            <Label htmlFor="bulk-rejection-reason">Reason</Label>
            <Textarea
              id="bulk-rejection-reason"
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
                Required, {REJECTION_REASON_MIN} to {REJECTION_REASON_MAX} characters. Every applicant receives this reason by e-mail, so
                write it for them.
              </span>
              <span className="shrink-0" aria-live="polite">
                {reason.length} / {REJECTION_REASON_MAX}
              </span>
            </div>
          </div>

          {(invalid || error) && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {invalid
                ? `Give a reason of ${REJECTION_REASON_MIN} to ${REJECTION_REASON_MAX} characters: the applicants are told why.`
                : error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || shown.length === 0}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {pending ? 'Rejecting...' : `Reject ${shown.length}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
