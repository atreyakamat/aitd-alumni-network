'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { getApiErrorMessage, getApiFieldErrors, jobApi, type CreateJobInput } from '@/lib/api';
import { isAdmin } from '@/lib/roles';

const selectClass =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

const EMPTY = {
  title: '',
  company: '',
  description: '',
  location: '',
  workplaceType: 'ONSITE' as NonNullable<CreateJobInput['workplaceType']>,
  jobType: 'FULL_TIME' as NonNullable<CreateJobInput['jobType']>,
  applicationLink: '',
  skills: '',
};

/** Message shown after creating a job, based on the moderation status returned. */
export function jobCreatedMessage(status: unknown): { title: string; description: string } {
  return status === 'PUBLISHED'
    ? { title: 'Job published', description: 'Your job is now live for members.' }
    : {
        title: 'Job submitted for review',
        description: 'An admin will review your posting before it is published. You will be notified.',
      };
}

export function PostJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState(EMPTY);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (open) setFieldErrors({});
  }, [open]);

  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: (payload: CreateJobInput) => jobApi.createJob(payload),
    onSuccess: (res) => {
      toast(jobCreatedMessage(res.data?.data?.status));
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setForm(EMPTY);
      onOpenChange(false);
    },
    onError: (err) => {
      setFieldErrors(getApiFieldErrors(err));
      toast({ title: 'Could not post job', description: getApiErrorMessage(err, 'Please try again.'), variant: 'destructive' });
    },
  });

  const valid = form.title.trim() && form.company.trim() && form.description.trim();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || mutation.isPending) return;
    const skills = form.skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    mutation.mutate({
      title: form.title.trim(),
      company: form.company.trim(),
      description: form.description.trim(),
      location: form.location.trim() || undefined,
      workplaceType: form.workplaceType,
      jobType: form.jobType,
      applicationLink: form.applicationLink.trim() || undefined,
      skills: skills.length ? skills : undefined,
    });
  };

  const err = (key: string) =>
    fieldErrors[key] ? <p className="text-xs text-destructive">{fieldErrors[key]}</p> : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Post a job</DialogTitle>
            <DialogDescription>
              {isAdmin(user)
                ? 'As an admin, your posting is published immediately.'
                : 'Postings are reviewed by an admin before they appear to members.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="job-title">Job title</Label>
              <Input id="job-title" value={form.title} onChange={set('title')} required />
              {err('title')}
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-company">Company</Label>
              <Input id="job-company" value={form.company} onChange={set('company')} required />
              {err('company')}
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="job-type">Type</Label>
              <select id="job-type" className={selectClass} value={form.jobType} onChange={set('jobType')}>
                <option value="FULL_TIME">Full-time</option>
                <option value="PART_TIME">Part-time</option>
                <option value="INTERNSHIP">Internship</option>
                <option value="CONTRACT">Contract</option>
                <option value="FREELANCE">Freelance</option>
                <option value="VOLUNTEER">Volunteer</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-workplace">Workplace</Label>
              <select id="job-workplace" className={selectClass} value={form.workplaceType} onChange={set('workplaceType')}>
                <option value="ONSITE">On-site</option>
                <option value="REMOTE">Remote</option>
                <option value="HYBRID">Hybrid</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-location">Location</Label>
              <Input id="job-location" value={form.location} onChange={set('location')} placeholder="City" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-desc">Description</Label>
            <Textarea id="job-desc" value={form.description} onChange={set('description')} rows={5} required />
            {err('description')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-skills">Skills (comma separated, optional)</Label>
            <Input id="job-skills" value={form.skills} onChange={set('skills')} placeholder="React, SQL" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-link">Application link (optional)</Label>
            <Input id="job-link" type="url" value={form.applicationLink} onChange={set('applicationLink')} placeholder="https://" />
            {err('applicationLink')}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || mutation.isPending}>
              {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isAdmin(user) ? 'Publish job' : 'Submit for review'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
