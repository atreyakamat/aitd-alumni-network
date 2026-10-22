'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
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
import {
  eventApi,
  getApiErrorMessage,
  getApiFieldErrors,
  readPaginated,
  type CreateAlbumInput,
  type GalleryAlbumType,
} from '@/lib/api';

const ALBUM_TYPES: Array<{ value: GalleryAlbumType; label: string }> = [
  { value: 'INSTITUTIONAL', label: 'Institutional' },
  { value: 'BATCH', label: 'Batch' },
  { value: 'EVENT', label: 'Event' },
];

const MIN_BATCH_YEAR = 1950;

interface FormValues {
  title: string;
  description: string;
  albumType: GalleryAlbumType;
  batchYear: string;
  eventId: string;
}

const EMPTY: FormValues = { title: '', description: '', albumType: 'INSTITUTIONAL', batchYear: '', eventId: '' };

/** Mirrors galleryService.createAlbum's rules; the server stays authoritative. */
export function validateAlbumForm(values: FormValues): Partial<Record<keyof FormValues, string>> {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (!values.title.trim()) errors.title = 'Title is required';
  if (values.albumType === 'BATCH') {
    const year = Number(values.batchYear);
    const maxYear = new Date().getFullYear() + 6;
    if (!Number.isInteger(year) || year < MIN_BATCH_YEAR || year > maxYear) errors.batchYear = 'Enter a valid batch year';
  }
  if (values.albumType === 'EVENT' && !values.eventId) errors.eventId = 'Choose an event';
  return errors;
}

interface CreateAlbumDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the payload; reject to keep the dialog open with the error shown. */
  onSubmit: (payload: CreateAlbumInput) => Promise<unknown>;
}

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/** ADMIN+ only (POST /gallery/albums). */
export function CreateAlbumDialog({ open, onOpenChange, onSubmit }: CreateAlbumDialogProps) {
  const [values, setValues] = React.useState<FormValues>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValues(EMPTY);
      setErrors({});
      setFormError(null);
    }
  }, [open]);

  const eventsQuery = useQuery({
    queryKey: ['gallery', 'album-events'],
    queryFn: async () => (await eventApi.getEvents({ limit: 50 })).data,
    enabled: open && values.albumType === 'EVENT',
  });
  const events = readPaginated<{ id: string; title: string; startDate?: string }>(eventsQuery.data).items;

  const set =
    (key: keyof FormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const clientErrors = validateAlbumForm(values);
    setErrors(clientErrors as Record<string, string>);
    setFormError(null);
    if (Object.keys(clientErrors).length) return;

    const payload: CreateAlbumInput = { title: values.title.trim(), albumType: values.albumType };
    const description = values.description.trim();
    if (description) payload.description = description;
    if (values.albumType === 'BATCH') payload.batchYear = Number(values.batchYear);
    if (values.albumType === 'EVENT') payload.eventId = values.eventId;

    setSubmitting(true);
    try {
      await onSubmit(payload);
      onOpenChange(false);
    } catch (err) {
      setErrors(getApiFieldErrors(err));
      setFormError(getApiErrorMessage(err, 'Could not create the album.'));
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <p id={`album-${key}-error`} className="text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>New album</DialogTitle>
            <DialogDescription>Create an album. Members can then add photos to batch and event albums they belong to.</DialogDescription>
          </DialogHeader>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="album-title">Title</Label>
            <Input id="album-title" value={values.title} onChange={set('title')} maxLength={200} aria-invalid={!!errors.title} />
            {fieldError('title')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="album-description">Description (optional)</Label>
            <Textarea id="album-description" value={values.description} onChange={set('description')} rows={3} maxLength={2000} />
            {fieldError('description')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="album-type">Album type</Label>
            <select id="album-type" className={selectClass} value={values.albumType} onChange={set('albumType')}>
              {ALBUM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {fieldError('albumType')}
          </div>

          {values.albumType === 'BATCH' && (
            <div className="space-y-2">
              <Label htmlFor="album-batch-year">Batch year</Label>
              <Input
                id="album-batch-year"
                type="number"
                inputMode="numeric"
                value={values.batchYear}
                onChange={set('batchYear')}
                placeholder="e.g. 2015"
                aria-invalid={!!errors.batchYear}
              />
              {fieldError('batchYear')}
            </div>
          )}

          {values.albumType === 'EVENT' && (
            <div className="space-y-2">
              <Label htmlFor="album-event">Event</Label>
              <select
                id="album-event"
                className={selectClass}
                value={values.eventId}
                onChange={set('eventId')}
                aria-invalid={!!errors.eventId}
                disabled={eventsQuery.isLoading}
              >
                <option value="">{eventsQuery.isLoading ? 'Loading events…' : 'Select an event'}</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title}
                    {ev.startDate ? ` (${new Date(ev.startDate).toLocaleDateString()})` : ''}
                  </option>
                ))}
              </select>
              {eventsQuery.isError && <p className="text-xs text-destructive">Could not load events.</p>}
              {fieldError('eventId')}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create album
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
