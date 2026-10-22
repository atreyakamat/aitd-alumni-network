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

export const MIN_DEACTIVATION_REASON = 5;

interface UserStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  /** The status the admin wants to set. */
  nextActive: boolean;
  pending?: boolean;
  onConfirm: (reason: string) => void;
}

/**
 * Confirm activation / deactivation. A reason is required to deactivate so
 * the audit trail explains the action; it is optional when reactivating.
 */
export function UserStatusDialog({
  open,
  onOpenChange,
  userName,
  nextActive,
  pending = false,
  onConfirm,
}: UserStatusDialogProps) {
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const trimmed = reason.trim();
  const reasonValid = nextActive || trimmed.length >= MIN_DEACTIVATION_REASON;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reasonValid && !pending) onConfirm(trimmed);
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{nextActive ? `Reactivate ${userName}?` : `Deactivate ${userName}?`}</DialogTitle>
            <DialogDescription>
              {nextActive
                ? 'They will be able to sign in and use the platform again.'
                : 'They will be signed out and blocked from signing in until reactivated. Their data is kept.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="status-reason">
              Reason {nextActive ? <span className="text-muted-foreground">(optional)</span> : null}
            </Label>
            <Textarea
              id="status-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={nextActive ? 'e.g. Appeal reviewed and approved' : 'e.g. Repeated spam in the feed'}
              rows={3}
              maxLength={500}
            />
            {!nextActive && (
              <p className="text-xs text-muted-foreground">
                Required, at least {MIN_DEACTIVATION_REASON} characters. Recorded in the audit log.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant={nextActive ? 'default' : 'destructive'} disabled={!reasonValid || pending}>
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {nextActive ? 'Reactivate' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
