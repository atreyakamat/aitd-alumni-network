'use client';

import * as React from 'react';
import { GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react';
import { userApi } from '@/lib/api';
import {
  blankToNull,
  maxProfileYear,
  MIN_PROFILE_YEAR,
  type EducationInput,
  type EducationRecord,
} from '@/lib/profile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYear: string;
  endYear: string;
  grade: string;
  isPrimary: boolean;
}

type TextField = Exclude<keyof FormValues, 'isPrimary'>;
type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMPTY: FormValues = {
  institution: '',
  degree: '',
  fieldOfStudy: '',
  startYear: '',
  endYear: '',
  grade: '',
  isPrimary: false,
};

const toFormValues = (row: EducationRecord): FormValues => ({
  institution: row.institution ?? '',
  degree: row.degree ?? '',
  fieldOfStudy: row.fieldOfStudy ?? '',
  startYear: row.startYear ? String(row.startYear) : '',
  endYear: row.endYear ? String(row.endYear) : '',
  grade: row.grade ?? '',
  isPrimary: Boolean(row.isPrimary),
});

const parseYear = (value: string): number | null => (/^\d{4}$/.test(value.trim()) ? Number(value.trim()) : null);

export function validateEducation(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const max = maxProfileYear();
  if (!values.institution.trim()) errors.institution = 'Institution is required';
  else if (values.institution.trim().length > 191) errors.institution = 'Institution must be at most 191 characters';
  if (!values.degree.trim()) errors.degree = 'Degree is required';
  else if (values.degree.trim().length > 150) errors.degree = 'Degree must be at most 150 characters';
  if (values.fieldOfStudy.trim().length > 150) errors.fieldOfStudy = 'Field of study must be at most 150 characters';
  if (values.grade.trim().length > 50) errors.grade = 'Grade must be at most 50 characters';

  const start = parseYear(values.startYear);
  if (start === null || start < MIN_PROFILE_YEAR || start > max) {
    errors.startYear = `Enter a start year between ${MIN_PROFILE_YEAR} and ${max}`;
  }
  if (values.endYear.trim()) {
    const end = parseYear(values.endYear);
    if (end === null || end < MIN_PROFILE_YEAR || end > max) errors.endYear = `Enter an end year between ${MIN_PROFILE_YEAR} and ${max}`;
    else if (start !== null && end < start) errors.endYear = 'End year cannot be before start year';
  }
  return errors;
}

export function toEducationPayload(values: FormValues): EducationInput {
  return {
    institution: values.institution.trim(),
    degree: values.degree.trim(),
    fieldOfStudy: blankToNull(values.fieldOfStudy),
    startYear: Number(values.startYear.trim()),
    endYear: values.endYear.trim() ? Number(values.endYear.trim()) : null,
    grade: blankToNull(values.grade),
    isPrimary: values.isPrimary,
  };
}

function EducationDialog({
  open,
  initial,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initial: EducationRecord | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: EducationInput) => Promise<{ ok: boolean; fieldErrors: Record<string, string> }>;
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
    const found = validateEducation(values);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    setSaving(true);
    try {
      const outcome = await onSubmit(toEducationPayload(values));
      if (!outcome.ok) setErrors(outcome.fieldErrors as FormErrors);
    } finally {
      setSaving(false);
    }
  };

  const field = (name: TextField, label: string, extra: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-2">
      <Label htmlFor={`edu-${name}`}>{label}</Label>
      <Input
        {...errorProps(`edu-${name}`, errors[name])}
        value={values[name]}
        onChange={(e) => set(name, e.target.value)}
        disabled={saving}
        {...extra}
      />
      <FieldError id={`edu-${name}`} message={errors[name]} />
    </div>
  );

  const yearProps = { type: 'number', inputMode: 'numeric' as const, min: MIN_PROFILE_YEAR, max: maxProfileYear(), step: 1 };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit education' : 'Add education'}</DialogTitle>
          <DialogDescription>Degrees, diplomas and certifications.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {field('institution', 'Institution')}
          <div className="grid gap-4 sm:grid-cols-2">
            {field('degree', 'Degree')}
            {field('fieldOfStudy', 'Field of study')}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {field('startYear', 'Start year', yearProps)}
            {field('endYear', 'End year', yearProps)}
            {field('grade', 'Grade')}
          </div>
          <CheckboxField
            id="edu-isPrimary"
            label="This is my AIEM degree"
            description="Your primary education is highlighted on your profile."
            checked={values.isPrimary}
            onChange={(checked) => set('isPrimary', checked)}
            disabled={saving}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <SaveButton saving={saving} label={initial ? 'Save changes' : 'Add education'} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EducationSection({ educations, onSaved }: SectionProps & { educations: EducationRecord[] }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<EducationRecord | null>(null);
  const [deleting, setDeleting] = React.useState<EducationRecord | null>(null);
  const { run } = useSectionSave(onSaved);

  const handleSubmit = async (payload: EducationInput) => {
    const outcome = await run(
      () => (editing ? userApi.updateEducation(editing.id, payload) : userApi.addEducation(payload)),
      editing
        ? { success: 'Education updated', failure: 'Could not update education' }
        : { success: 'Education added', failure: 'Could not add education' }
    );
    if (outcome.ok) setDialogOpen(false);
    return outcome;
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const outcome = await run(() => userApi.deleteEducation(deleting.id), {
      success: 'Education removed',
      failure: 'Could not remove education',
    });
    if (outcome.ok) setDeleting(null);
  };

  return (
    <Card id="education">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="text-lg flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
            Education
          </CardTitle>
          <CardDescription>Your degrees, including the one from AIEM.</CardDescription>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1" aria-hidden />
          Add education
        </Button>
      </CardHeader>
      <CardContent>
        {educations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No education added yet.</p>
        ) : (
          <ul className="divide-y">
            {educations.map((row) => (
              <li key={row.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="font-medium flex flex-wrap items-center gap-2">
                    {row.institution}
                    {row.isPrimary && <Badge variant="secondary">Primary</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[row.degree, row.fieldOfStudy].filter(Boolean).join(', ')}
                    {row.grade ? ` · ${row.grade}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.startYear} - {row.endYear ?? 'Present'}
                  </p>
                </div>
                <div className="flex shrink-0 items-start gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      setEditing(row);
                      setDialogOpen(true);
                    }}
                    aria-label={`Edit ${row.degree} at ${row.institution}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setDeleting(row)}
                    aria-label={`Delete ${row.degree} at ${row.institution}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <EducationDialog open={dialogOpen} initial={editing} onOpenChange={setDialogOpen} onSubmit={handleSubmit} />
      <ConfirmDeleteDialog
        open={Boolean(deleting)}
        title="Remove this education?"
        description={deleting ? `${deleting.degree} at ${deleting.institution} will be removed from your profile.` : ''}
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={handleDelete}
      />
    </Card>
  );
}
