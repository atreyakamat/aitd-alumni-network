'use client';

import * as React from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Check, KeyRound, Loader2, X } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { authApi, getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { evaluatePasswordRules, passwordSchema } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'New password must be different from your current password',
    path: ['newPassword'],
  });

type Field = 'currentPassword' | 'newPassword' | 'confirmPassword';
type FieldErrors = Partial<Record<Field, string>>;

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' };

export function ChangePasswordCard() {
  const { setAuthData } = useAuth();
  const { toast } = useToast();
  const [values, setValues] = React.useState(EMPTY);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<{ message: string; code?: string } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const rules = evaluatePasswordRules(values.newPassword);

  const update = (field: Field) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setValues((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);

    const parsed = changePasswordSchema.safeParse(values);
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        errors[field] ??= issue.message;
      }
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const res = await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      const { accessToken, refreshToken } = res.data.data;
      // Every other session was revoked; this device continues on the fresh pair.
      setAuthData({ accessToken, refreshToken });
      setValues(EMPTY);
      setFieldErrors({});
      toast({ title: 'Password changed', description: 'Other devices have been signed out.' });
    } catch (err) {
      setServerError({
        message: getApiErrorMessage(err, 'Could not change your password. Please try again.'),
        code: getApiErrorCode(err),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const fieldError = (field: Field) =>
    fieldErrors[field] ? (
      <p id={`${field}-error`} className="text-sm text-destructive">
        {fieldErrors[field]}
      </p>
    ) : null;

  const inputProps = (field: Field, autoComplete: string) => ({
    id: field,
    type: 'password',
    autoComplete,
    value: values[field],
    onChange: update(field),
    disabled: submitting,
    'aria-invalid': Boolean(fieldErrors[field]) || undefined,
    'aria-describedby': fieldErrors[field] ? `${field}-error` : undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          Change password
        </CardTitle>
        <CardDescription>Changing your password signs you out on every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Current password</Label>
            <Input {...inputProps('currentPassword', 'current-password')} />
            {fieldError('currentPassword')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">New password</Label>
            <Input {...inputProps('newPassword', 'new-password')} />
            <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Password requirements">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  data-met={rule.met}
                  className={cn('flex items-center gap-1', rule.met ? 'text-green-600' : 'text-muted-foreground')}
                >
                  {rule.met ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                  {rule.label}
                </li>
              ))}
            </ul>
            {fieldError('newPassword')}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input {...inputProps('confirmPassword', 'new-password')} />
            {fieldError('confirmPassword')}
          </div>

          {serverError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <p>{serverError.message}</p>
              {serverError.code === 'PASSWORD_NOT_SET' && (
                <Link href="/forgot-password" className="mt-1 inline-block font-medium underline">
                  Reset your password
                </Link>
              )}
            </div>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitting ? 'Changing password...' : 'Change password'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
