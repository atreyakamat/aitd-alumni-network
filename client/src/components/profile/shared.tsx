'use client';

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage, getApiFieldErrors } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Called after any successful profile edit (refreshes the profile query and the auth user). */
export type OnProfileSaved = () => Promise<void> | void;

export interface SectionProps {
  onSaved: OnProfileSaved;
}

interface SaveMessages {
  success: string;
  failure: string;
}

/**
 * Runs one section's save with a loading flag, a success toast and a destructive toast
 * carrying the server's message. Server field errors (400 VALIDATION_ERROR) are returned
 * so the section can show them inline.
 */
export function useSectionSave(onSaved?: OnProfileSaved) {
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);

  const run = React.useCallback(
    async (action: () => Promise<unknown>, messages: SaveMessages) => {
      setSaving(true);
      try {
        const result = await action();
        toast({ title: messages.success });
        try {
          await onSaved?.();
        } catch {
          // The save itself succeeded; a failed refresh is not worth an error toast.
        }
        return { ok: true as const, result, fieldErrors: {} as Record<string, string> };
      } catch (err) {
        toast({
          variant: 'destructive',
          title: messages.failure,
          description: getApiErrorMessage(err, 'Please try again.'),
        });
        return { ok: false as const, result: undefined, fieldErrors: getApiFieldErrors(err) };
      } finally {
        setSaving(false);
      }
    },
    [onSaved, toast]
  );

  return { saving, run };
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={`${id}-error`} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/** aria props for an input with an optional error message rendered by <FieldError>. */
export const errorProps = (id: string, message?: string) => ({
  id,
  'aria-invalid': message ? true : undefined,
  'aria-describedby': message ? `${id}-error` : undefined,
});

export function SaveButton({ saving, label, savingLabel = 'Saving...', ...props }: React.ComponentProps<typeof Button> & {
  saving: boolean;
  label: string;
  savingLabel?: string;
}) {
  return (
    <Button type="submit" disabled={saving || props.disabled} {...props}>
      {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
      {saving ? savingLabel : label}
    </Button>
  );
}

export function ConfirmDeleteDialog({
  open,
  title,
  description,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = React.useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={deleting}>
            {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Native checkbox styled to match the form controls (no Radix checkbox wrapper exists yet). */
export function CheckboxField({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-input accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="text-sm font-medium leading-none">
          {label}
        </label>
        {description && (
          <p id={`${id}-description`} className="text-xs text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export const selectClassName =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
