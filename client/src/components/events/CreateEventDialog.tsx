'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { chapterApi, eventApi, getApiErrorMessage, getApiFieldErrors, type CreateEventInput } from '@/lib/api';
import { isAdmin } from '@/lib/roles';

interface ChapterOption {
  id: string;
  name: string;
}

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

/**
 * Create-event form. ADMIN+ may create platform-wide events (chapter optional);
 * CHAPTER_ADMINs must pick a chapter they administer (server enforces).
 */
export function CreateEventDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const admin = isAdmin(user);

  const [form, setForm] = React.useState({
    title: '',
    description: '',
    eventType: 'OFFLINE' as NonNullable<CreateEventInput['eventType']>,
    startDate: '',
    endDate: '',
    venue: '',
    city: '',
    joinLink: '',
    capacity: '',
    chapterId: '',
  });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (open) setFieldErrors({});
  }, [open]);

  const chaptersQuery = useQuery({
    queryKey: ['event-chapter-options', admin ? 'all' : user?.id],
    enabled: open && !!user,
    queryFn: async (): Promise<ChapterOption[]> => {
      if (admin) {
        const res = await chapterApi.getChapters(1, 100);
        const list = res.data?.data ?? res.data?.items ?? [];
        return (Array.isArray(list) ? list : []).map((c: any) => ({ id: c.id, name: c.name }));
      }
      const res = await chapterApi.getMyChapters();
      const list: any[] = res.data?.data ?? [];
      return list.filter((c) => c.adminUserId === user?.id).map((c) => ({ id: c.id, name: c.name }));
    },
  });

  const chapters = React.useMemo(() => chaptersQuery.data ?? [], [chaptersQuery.data]);

  React.useEffect(() => {
    if (!admin && chapters.length === 1 && !form.chapterId) {
      setForm((f) => ({ ...f, chapterId: chapters[0].id }));
    }
  }, [admin, chapters, form.chapterId]);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (payload: CreateEventInput) => eventApi.createEvent(payload),
    onSuccess: () => {
      toast({ title: 'Event created', description: `"${form.title}" has been published.` });
      queryClient.invalidateQueries({ queryKey: ['events'] });
      onOpenChange(false);
      setForm((f) => ({ ...f, title: '', description: '', startDate: '', endDate: '', venue: '', city: '', joinLink: '', capacity: '' }));
    },
    onError: (err) => {
      setFieldErrors(getApiFieldErrors(err));
      toast({ title: 'Could not create event', description: getApiErrorMessage(err, 'Please try again.'), variant: 'destructive' });
    },
  });

  const needsChapter = !admin;
  const noChapters = needsChapter && chaptersQuery.isSuccess && chapters.length === 0;
  const endBeforeStart = !!form.endDate && !!form.startDate && new Date(form.endDate) <= new Date(form.startDate);
  const valid =
    form.title.trim() && form.description.trim() && form.startDate && !endBeforeStart && (!needsChapter || form.chapterId);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || mutation.isPending) return;
    const capacity = parseInt(form.capacity, 10);
    const payload: CreateEventInput = {
      title: form.title.trim(),
      description: form.description.trim(),
      eventType: form.eventType,
      startDate: toIso(form.startDate)!,
      endDate: toIso(form.endDate),
      venue: form.eventType !== 'ONLINE' ? form.venue.trim() || undefined : undefined,
      city: form.eventType !== 'ONLINE' ? form.city.trim() || undefined : undefined,
      joinLink: form.eventType !== 'OFFLINE' ? form.joinLink.trim() || undefined : undefined,
      capacity: Number.isFinite(capacity) && capacity > 0 ? capacity : undefined,
      chapterId: form.chapterId || undefined,
    };
    mutation.mutate(payload);
  };

  const err = (key: string) =>
    fieldErrors[key] ? <p className="text-xs text-destructive">{fieldErrors[key]}</p> : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Create event</DialogTitle>
            <DialogDescription>
              {admin ? 'Publish an event for the whole network or a specific chapter.' : 'Publish an event for a chapter you run.'}
            </DialogDescription>
          </DialogHeader>

          {noChapters ? (
            <p className="text-sm text-muted-foreground" role="alert">
              You are not the admin of any chapter yet, so you cannot create events. Ask a platform admin to assign you.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="ev-chapter">Chapter{needsChapter ? '' : ' (optional)'}</Label>
                <select id="ev-chapter" className={selectClass} value={form.chapterId} onChange={set('chapterId')} disabled={chaptersQuery.isLoading}>
                  <option value="">{chaptersQuery.isLoading ? 'Loading chapters...' : needsChapter ? 'Select a chapter' : 'Whole network'}</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {err('chapterId')}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ev-title">Title</Label>
                <Input id="ev-title" value={form.title} onChange={set('title')} maxLength={200} required />
                {err('title')}
              </div>
              <div className="space-y-2">
                <Label htmlFor="ev-desc">Description</Label>
                <Textarea id="ev-desc" value={form.description} onChange={set('description')} rows={4} required />
                {err('description')}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ev-start">Starts</Label>
                  <Input id="ev-start" type="datetime-local" value={form.startDate} onChange={set('startDate')} required />
                  {err('startDate')}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ev-end">Ends (optional)</Label>
                  <Input id="ev-end" type="datetime-local" value={form.endDate} onChange={set('endDate')} />
                  {endBeforeStart && <p className="text-xs text-destructive">End must be after the start.</p>}
                  {err('endDate')}
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ev-type">Format</Label>
                  <select id="ev-type" className={selectClass} value={form.eventType} onChange={set('eventType')}>
                    <option value="OFFLINE">In person</option>
                    <option value="ONLINE">Online</option>
                    <option value="HYBRID">Hybrid</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ev-capacity">Capacity (optional)</Label>
                  <Input id="ev-capacity" inputMode="numeric" value={form.capacity} onChange={set('capacity')} placeholder="Unlimited" />
                  {err('capacity')}
                </div>
              </div>
              {form.eventType !== 'ONLINE' && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ev-venue">Venue</Label>
                    <Input id="ev-venue" value={form.venue} onChange={set('venue')} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ev-city">City</Label>
                    <Input id="ev-city" value={form.city} onChange={set('city')} />
                  </div>
                </div>
              )}
              {form.eventType !== 'OFFLINE' && (
                <div className="space-y-2">
                  <Label htmlFor="ev-link">Join link</Label>
                  <Input id="ev-link" type="url" value={form.joinLink} onChange={set('joinLink')} placeholder="https://" />
                  {err('joinLink')}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            {!noChapters && (
              <Button type="submit" disabled={!valid || mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create event
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
