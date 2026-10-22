'use client';

import * as React from 'react';
import { Briefcase, Building, Pencil, Plus, Trash2 } from 'lucide-react';
import { userApi } from '@/lib/api';
import {
  blankToNull,
  dateToMonth,
  formatMonth,
  monthToDate,
  type WorkExperienceInput,
  type WorkExperienceRecord,
} from '@/lib/profile';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  CheckboxField,
  ConfirmDeleteDialog,
  errorProps,
  FieldError,
  SaveButton,
  useSectionSave,
  type SectionProps,
} from './shared';

interface FormValues {
  company: string;
  role: string;
  location: string;
  startMonth: string;
  endMonth: string;
  isCurrent: boolean;
  description: string;
}

type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY: FormValues = {
  company: '',
  role: '',
  location: '',
  startMonth: '',
  endMonth: '',
  isCurrent: false,
  description: '',
};

const toFormValues = (row: WorkExperienceRecord): FormValues => ({
  company: row.company ?? '',
  role: row.role ?? '',
  location: row.location ?? '',
  startMonth: dateToMonth(row.startDate),
  endMonth: row.isCurrent ? '' : dateToMonth(row.endDate),
  isCurrent: Boolean(row.isCurrent),
  description: row.description ?? '',
});

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function validateWorkExperience(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  if (!values.company.trim()) errors.company = 'Company is required';
  else if (values.company.trim().length > 150) errors.company = 'Company must be at most 150 characters';
  if (!values.role.trim()) errors.role = 'Role is required';
  else if (values.role.trim().length > 150) errors.role = 'Role must be at most 150 characters';
  if (values.location.trim().length > 150) errors.location = 'Location must be at most 150 characters';
  if (values.description.length > 2000) errors.description = 'Description must be at most 2000 characters';
  if (!MONTH_PATTERN.test(values.startMonth)) errors.startMonth = 'Start month is required';
  if (!values.isCurrent && values.endMonth) {
    if (!MONTH_PATTERN.test(values.endMonth)) errors.endMonth = 'Enter a valid end month';
    else if (!errors.startMonth && values.endMonth < values.startMonth) errors.endMonth = 'End month cannot be before start month';
  }
  return errors;
}

export function toWorkExperiencePayload(values: FormValues): WorkExperienceInput {
  return {
    company: values.company.trim(),
    role: values.role.trim(),
    location: blankToNull(values.location),
    startDate: monthToDate(values.startMonth),
    endDate: values.isCurrent || !values.endMonth ? null : monthToDate(values.endMonth),
    isCurrent: values.isCurrent,
    description: blankToNull(values.description),
  };
}

function WorkExperienceDialog({
  open,
  initial,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initial: WorkExperienceRecord | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: WorkExperienceInput) => Promise<{ ok: boolean; fieldErrors: Record<string, string> }>;
}) {
  const [values, setValues] = React.useState<FormValues>(EMPTY);
  const [errors, setErrors] = React.useState<FormErrors>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setValues(initial ? toFormValues(initial) : EMPTY);
      setErrors({});
    }
  }, [open, initial]);

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateWorkExperience(values);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      const outcome = await onSubmit(toWorkExperiencePayload(values));
      if (!outcome.ok) {
        const server = outcome.fieldErrors;
        setErrors({
          company: server.company,
          role: server.role,
          location: server.location,
          description: server.description,
          startMonth: server.startDate,
          endMonth: server.endDate,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const text = (field: 'company' | 'role' | 'location', label: string) => (
    <div className="space-y-2">
      <Label htmlFor={`work-${field}`}>{label}</Label>
      <Input
        {...errorProps(`work-${field}`, errors[field])}
        value={values[field]}
        onChange={(e) => set(field, e.target.value)}
        disabled={saving}
      />
      <FieldError id={`work-${field}`} message={errors[field]} />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit experience' : 'Add experience'}</DialogTitle>
          <DialogDescription>Where you worked and what you did there.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {text('company', 'Company')}
          {text('role', 'Role')}
          {text('location', 'Location')}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="work-startMonth">Start month</Label>
              <Input
                {...errorProps('work-startMonth', errors.startMonth)}
                type="month"
                placeholder="YYYY-MM"
                value={values.startMonth}
                onChange={(e) => set('startMonth', e.target.value)}
                disabled={saving}
              />
              <FieldError id="work-startMonth" message={errors.startMonth} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="work-endMonth">End month</Label>
              <Input
                {...errorProps('work-endMonth', errors.endMonth)}
                type="month"
                placeholder="YYYY-MM"
                value={values.isCurrent ? '' : values.endMonth}
                onChange={(e) => set('endMonth', e.target.value)}
                disabled={saving || values.isCurrent}
              />
              <FieldError id="work-endMonth" message={errors.endMonth} />
            </div>
          </div>
          <CheckboxField
            id="work-isCurrent"
            label="I currently work here"
            checked={values.isCurrent}
            onChange={(checked) => set('isCurrent', checked)}
            disabled={saving}
          />
          <div className="space-y-2">
            <Label htmlFor="work-description">Description</Label>
            <Textarea
              {...errorProps('work-description', errors.description)}
              rows={3}
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              disabled={saving}
            />
            <FieldError id="work-description" message={errors.description} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <SaveButton saving={saving} label={initial ? 'Save changes' : 'Add experience'} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function WorkExperienceSection({
  experiences,
  onSaved,
}: SectionProps & { experiences: WorkExperienceRecord[] }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<WorkExperienceRecord | null>(null);
  const [deleting, setDeleting] = React.useState<WorkExperienceRecord | null>(null);
  const { run } = useSectionSave(onSaved);

  const openAdd = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (row: WorkExperienceRecord) => {
    setEditing(row);
    setDialogOpen(true);
  };

  const handleSubmit = async (payload: WorkExperienceInput) => {
    const outcome = await run(
      () => (editing ? userApi.updateWorkExperience(editing.id, payload) : userApi.addWorkExperience(payload)),
      editing
        ? { success: 'Experience updated', failure: 'Could not update experience' }
        : { success: 'Experience added', failure: 'Could not add experience' }
    );
    if (outcome.ok) setDialogOpen(false);
    return outcome;
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const outcome = await run(() => userApi.deleteWorkExperience(deleting.id), {
      success: 'Experience removed',
      failure: 'Could not remove experience',
    });
    if (outcome.ok) setDeleting(null);
  };

  return (
    <Card id="experience">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-lg flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-primary" aria-hidden />
            Work experience
          </CardTitle>
          <CardDescription>Your current role appears on your directory card.</CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={openAdd}>
          <Plus className="h-4 w-4 mr-1" aria-hidden />
          Add experience
        </Button>
      </CardHeader>
      <CardContent>
        {experiences.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work experience yet. Add your current or past roles.</p>
        ) : (
          <ul className="divide-y">
            {experiences.map((row) => (
              <li key={row.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-secondary">
                  <Building className="h-5 w-5 text-muted-foreground" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{row.role}</p>
                  <p className="text-sm text-muted-foreground">
                    {row.company}
                    {row.location ? ` · ${row.location}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatMonth(row.startDate)} - {row.isCurrent ? 'Present' : formatMonth(row.endDate) || 'Not specified'}
                  </p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => openEdit(row)}
                    aria-label={`Edit ${row.role} at ${row.company}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setDeleting(row)}
                    aria-label={`Delete ${row.role} at ${row.company}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <WorkExperienceDialog open={dialogOpen} initial={editing} onOpenChange={setDialogOpen} onSubmit={handleSubmit} />
      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title="Remove this experience?"
        description={deleting ? `${deleting.role} at ${deleting.company} will be removed from your profile.` : ''}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={handleDelete}
      />
    </Card>
  );
}
