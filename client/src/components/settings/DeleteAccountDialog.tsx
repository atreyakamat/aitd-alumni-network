'use client';

import * as React from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getApiErrorMessage, type DeleteAccountPayload } from '@/lib/api';
import { cn } from '@/lib/utils';

export type DeleteMode = 'password' | 'confirm';

export const DELETE_CONFIRM_WORD = 'DELETE';

export function isDeleteConfirmationValid(mode: DeleteMode, password: string, confirmText: string): boolean {
  return mode === 'password' ? password.trim().length > 0 : confirmText.trim() === DELETE_CONFIRM_WORD;
}

export function buildDeletePayload(mode: DeleteMode, password: string, _confirmText: string): DeleteAccountPayload {
  return mode === 'password' ? { password } : { confirm: DELETE_CONFIRM_WORD };
}

interface DeleteAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Perform the deletion; reject with the API error to show it inline. */
  onConfirm: (payload: DeleteAccountPayload) => Promise<void>;
}

export function DeleteAccountDialog({ open, onOpenChange, onConfirm }: DeleteAccountDialogProps) {
  const [mode, setMode] = React.useState<DeleteMode>('password');
  const [password, setPassword] = React.useState('');
  const [confirmText, setConfirmText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMode('password');
      setPassword('');
      setConfirmText('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const valid = isDeleteConfirmationValid(mode, password, confirmText);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(buildDeletePayload(mode, password, confirmText));
    } catch (err) {
      setError(getApiErrorMessage(err, 'We could not delete your account. Please try again.'));
      setSubmitting(false);
    }
  };

  const modeOption = (value: DeleteMode, label: string) => (
    <label
      className={cn(
        'flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer',
        mode === value ? 'border-primary bg-primary/5' : 'border-input'
      )}
    >
      <input
        type="radio"
        name="delete-mode"
        value={value}
        checked={mode === value}
        onChange={() => {
          setMode(value);
          setError(null);
        }}
        className="accent-primary"
      />
      {label}
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete your account?
            </DialogTitle>
            <DialogDescription>
              This permanently removes your profile, connections, experience and listings. Posts, donations and
              payment records are kept but shown as “Deleted User”. This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium mb-2">How do you sign in?</legend>
            <div className="grid sm:grid-cols-2 gap-2">
              {modeOption('password', 'Email and password')}
              {modeOption('confirm', 'Google or LinkedIn')}
            </div>
          </fieldset>

          {mode === 'password' ? (
            <div className="space-y-2">
              <Label htmlFor="delete-password">Current password</Label>
              <Input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">
                Type <span className="font-mono font-semibold">{DELETE_CONFIRM_WORD}</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                autoComplete="off"
                autoCapitalize="characters"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={submitting}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!valid || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete my account'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
