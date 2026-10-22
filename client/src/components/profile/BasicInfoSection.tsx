'use client';

import * as React from 'react';
import { UserRound } from 'lucide-react';
import { userApi } from '@/lib/api';
import { BIO_MAX, basicInfoSchema, blankToNull, fieldErrorsFrom, type EditableProfile } from '@/lib/profile';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { errorProps, FieldError, SaveButton, useSectionSave, type SectionProps } from './shared';

type Field = 'fullName' | 'currentDesignation' | 'shortBio';

export function BasicInfoSection({ profile, onSaved }: SectionProps & { profile: EditableProfile }) {
  const [values, setValues] = React.useState<Record<Field, string>>({
    fullName: profile.fullName ?? '',
    currentDesignation: profile.currentDesignation ?? '',
    shortBio: profile.shortBio ?? '',
  });
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const { saving, run } = useSectionSave(onSaved);

  const update = (field: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = e.target.value;
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = basicInfoSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error));
      return;
    }
    const outcome = await run(
      () =>
        userApi.updateProfile({
          fullName: parsed.data.fullName,
          currentDesignation: blankToNull(parsed.data.currentDesignation),
          shortBio: blankToNull(parsed.data.shortBio),
        }),
      { success: 'Basic info saved', failure: 'Could not save basic info' }
    );
    if (!outcome.ok) setErrors(outcome.fieldErrors);
  };

  const bioLength = values.shortBio.length;

  return (
    <Card id="basic-info">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <UserRound className="h-5 w-5 text-primary" aria-hidden />
          Basic info
        </CardTitle>
        <CardDescription>How you appear in the directory and on your profile.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              {...errorProps('fullName', errors.fullName)}
              autoComplete="name"
              value={values.fullName}
              onChange={update('fullName')}
              disabled={saving}
            />
            <FieldError id="fullName" message={errors.fullName} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentDesignation">Current designation</Label>
            <Input
              {...errorProps('currentDesignation', errors.currentDesignation)}
              placeholder="e.g. Senior Engineer at Acme"
              autoComplete="organization-title"
              value={values.currentDesignation}
              onChange={update('currentDesignation')}
              disabled={saving}
            />
            <FieldError id="currentDesignation" message={errors.currentDesignation} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="shortBio">Bio</Label>
              <span
                data-testid="bio-counter"
                className={cn('text-xs', bioLength > BIO_MAX ? 'text-destructive' : 'text-muted-foreground')}
                aria-live="polite"
              >
                {bioLength}/{BIO_MAX}
              </span>
            </div>
            <Textarea
              {...errorProps('shortBio', errors.shortBio)}
              rows={4}
              placeholder="A few lines about your work and interests"
              value={values.shortBio}
              onChange={update('shortBio')}
              disabled={saving}
            />
            <FieldError id="shortBio" message={errors.shortBio} />
          </div>

          <dl className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Department</dt>
              <dd>{profile.department || '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Degree</dt>
              <dd>{profile.degree || '-'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Batch</dt>
              <dd>{profile.batchYear || '-'}</dd>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-3">
              Department, degree and batch come from your registration. Contact an administrator to correct them.
            </p>
          </dl>

          <SaveButton saving={saving} label="Save basic info" />
        </form>
      </CardContent>
    </Card>
  );
}
