'use client';

import * as React from 'react';
import { Link2 } from 'lucide-react';
import { userApi } from '@/lib/api';
import { blankToNull, contactSchema, fieldErrorsFrom, type EditableProfile } from '@/lib/profile';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { errorProps, FieldError, SaveButton, useSectionSave, type SectionProps } from './shared';

type Field = 'phoneNumber' | 'secondaryEmail' | 'linkedinUrl' | 'twitterUrl' | 'githubUrl' | 'websiteUrl';

const FIELDS: { field: Field; label: string; type: string; placeholder: string; autoComplete?: string }[] = [
  { field: 'phoneNumber', label: 'Phone number', type: 'tel', placeholder: '+91 98765 43210', autoComplete: 'tel' },
  { field: 'secondaryEmail', label: 'Secondary email', type: 'email', placeholder: 'you@example.com', autoComplete: 'email' },
  { field: 'linkedinUrl', label: 'LinkedIn', type: 'url', placeholder: 'https://www.linkedin.com/in/your-name' },
  { field: 'twitterUrl', label: 'Twitter / X', type: 'url', placeholder: 'https://x.com/your-handle' },
  { field: 'githubUrl', label: 'GitHub', type: 'url', placeholder: 'https://github.com/your-name' },
  { field: 'websiteUrl', label: 'Website', type: 'url', placeholder: 'https://example.com' },
];

export function ContactLinksSection({ profile, onSaved }: SectionProps & { profile: EditableProfile }) {
  const [values, setValues] = React.useState<Record<Field, string>>(() => ({
    phoneNumber: profile.phoneNumber ?? '',
    secondaryEmail: profile.secondaryEmail ?? '',
    linkedinUrl: profile.linkedinUrl ?? '',
    twitterUrl: profile.twitterUrl ?? '',
    githubUrl: profile.githubUrl ?? '',
    websiteUrl: profile.websiteUrl ?? '',
  }));
  const [errors, setErrors] = React.useState<Partial<Record<Field, string>>>({});
  const { saving, run } = useSectionSave(onSaved);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = contactSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFrom(parsed.error));
      return;
    }
    const payload = Object.fromEntries(FIELDS.map(({ field }) => [field, blankToNull(parsed.data[field])]));
    const outcome = await run(() => userApi.updateProfile(payload), {
      success: 'Contact details saved',
      failure: 'Could not save contact details',
    });
    if (!outcome.ok) setErrors(outcome.fieldErrors);
  };

  return (
    <Card id="contact">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Link2 className="h-5 w-5 text-primary" aria-hidden />
          Contact &amp; links
        </CardTitle>
        <CardDescription>Links must be full addresses starting with https://. Choose who sees your phone under Privacy.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map(({ field, label, type, placeholder, autoComplete }) => (
              <div key={field} className="space-y-2">
                <Label htmlFor={field}>{label}</Label>
                <Input
                  {...errorProps(field, errors[field])}
                  type={type}
                  placeholder={placeholder}
                  autoComplete={autoComplete}
                  value={values[field]}
                  onChange={(e) => {
                    const value = e.target.value;
                    setValues((prev) => ({ ...prev, [field]: value }));
                    setErrors((prev) => ({ ...prev, [field]: undefined }));
                  }}
                  disabled={saving}
                />
                <FieldError id={field} message={errors[field]} />
              </div>
            ))}
          </div>
          <SaveButton saving={saving} label="Save contact details" />
        </form>
      </CardContent>
    </Card>
  );
}
