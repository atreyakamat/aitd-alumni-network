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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getApiErrorMessage, getApiFieldErrors, type CreateChapterInput } from '@/lib/api';
import { validateChapterForm, type ChapterFormValues } from '@/lib/chapters';
import type { Chapter } from '@/types';

interface ChapterFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Prefills the form in edit mode. */
  chapter?: Pick<Chapter, 'name' | 'region' | 'description' | 'logoUrl'> | null;
  /** Receives the trimmed payload; reject to keep the dialog open with the error shown. */
  onSubmit: (payload: CreateChapterInput) => Promise<unknown>;
}

const toValues = (chapter?: ChapterFormDialogProps['chapter']): ChapterFormValues => ({
  name: chapter?.name ?? '',
  region: chapter?.region ?? '',
  description: chapter?.description ?? '',
  logoUrl: chapter?.logoUrl ?? '',
});

/** Create (ADMIN+) or edit (chapter admin / ADMIN+) a chapter. The server enforces access. */
export function ChapterFormDialog({ open, onOpenChange, mode, chapter, onSubmit }: ChapterFormDialogProps) {
  const [values, setValues] = React.useState<ChapterFormValues>(() => toValues(chapter));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValues(toValues(chapter));
      setErrors({});
      setFormError(null);
    }
    // Only reset when the dialog opens, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key: keyof ChapterFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const clientErrors = validateChapterForm(values);
    setErrors(clientErrors as Record<string, string>);
    setFormError(null);
    if (Object.keys(clientErrors).length) return;

    const payload: CreateChapterInput = {
      name: values.name.trim(),
      region: values.region.trim(),
      description: values.description.trim() || undefined,
      logoUrl: values.logoUrl.trim() || undefined,
    };
    setSubmitting(true);
    try {
      await onSubmit(payload);
      onOpenChange(false);
    } catch (err) {
      setErrors(getApiFieldErrors(err));
      setFormError(getApiErrorMessage(err, mode === 'create' ? 'Could not create the chapter.' : 'Could not save changes.'));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`chapter-${key}-error`} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>{mode === 'create' ? 'Create chapter' : 'Edit chapter'}</DialogTitle>
            <DialogDescription>
              {mode === 'create'
                ? 'Start a new regional chapter. You can assign a chapter admin afterwards.'
                : 'Update how this chapter appears to members.'}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="chapter-name">Name</Label>
            <Input id="chapter-name" value={values.name} onChange={set('name')} maxLength={120} aria-invalid={!!errors.name} />
            {fieldError('name')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="chapter-region">Region</Label>
            <Input
              id="chapter-region"
              value={values.region}
              onChange={set('region')}
              maxLength={120}
              placeholder="e.g. North India, USA"
              aria-invalid={!!errors.region}
            />
            {fieldError('region')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="chapter-description">Description (optional)</Label>
            <Textarea id="chapter-description" value={values.description} onChange={set('description')} rows={4} maxLength={2000} />
            {fieldError('description')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="chapter-logo">Logo URL (optional)</Label>
            <Input
              id="chapter-logo"
              type="url"
              value={values.logoUrl}
              onChange={set('logoUrl')}
              placeholder="https://"
              aria-invalid={!!errors.logoUrl}
            />
            {fieldError('logoUrl')}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === 'create' ? 'Create chapter' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
