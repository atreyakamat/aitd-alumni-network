'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { passwordSchema } from '@/lib/auth';
import { authApi, getApiErrorMessage, getApiFieldErrors } from '@/lib/api';
import { buildLoginHref, getSafeNextPath } from '@/lib/public-paths';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { DEPARTMENTS } from '@/lib/departments';
import { CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';

const departments = DEPARTMENTS;

const degrees = ['B.Tech', 'M.Tech', 'B.E.', 'M.E.', 'PhD'];

const currentYear = new Date().getFullYear();
const batchYears = Array.from({ length: 50 }, (_, i) => currentYear - i);

const ENROLMENT_MAX = 50;
const NOTE_MAX = 1000;

const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  password: passwordSchema,
  confirmPassword: z.string(),
  batchYear: z.number({ required_error: 'Please select your batch year' }),
  department: z.string({ required_error: 'Please select your department' }),
  degree: z.string({ required_error: 'Please select your degree' }),
  roleType: z.enum(['ALUMNI', 'STUDENT']).default('ALUMNI'),
  // Optional, and only there to help the administrator who checks the registration (mirrors the server limits)
  enrollmentNumber: z.string().trim().max(ENROLMENT_MAX, 'Enrolment number is too long').optional(),
  verificationNote: z.string().trim().max(NOTE_MAX, `Please keep this under ${NOTE_MAX} characters`).optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

type RegisterFormData = z.infer<typeof registerSchema>;

const registerSchemaShape = registerSchema._def.schema.shape;

/** Shown instead of the form once the registration is accepted. There is no session: the person has to wait for an administrator. */
function WhatHappensNext({ email, loginHref }: { email: string; loginHref: string }) {
  return (
    <>
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-7 w-7 text-green-700" aria-hidden />
        </div>
        <CardTitle className="font-headline text-3xl text-primary">Registration received</CardTitle>
        <CardDescription className="font-body">
          You can sign in as soon as an administrator has approved your registration.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h2 className="mb-3 text-lg font-semibold text-primary">What happens next</h2>
          <ol aria-label="What happens next" className="list-decimal space-y-3 pl-5 text-sm font-body">
            <li>
              <strong>Verify your e-mail.</strong> Open the link we sent to <strong className="break-all">{email}</strong> and
              confirm with your password.
            </li>
            <li>
              <strong>An administrator checks that you are an alumnus of the college.</strong> This is done by a person, so it
              can take a little while.
            </li>
            <li>
              <strong>You get an e-mail when you are approved.</strong> Then you can sign in and join the network.
            </li>
          </ol>
        </div>
        <Button asChild className="w-full">
          <Link href={loginHref}>Go to sign in</Link>
        </Button>
        <p className="text-center text-sm text-muted-foreground font-body">
          Did not get the e-mail?{' '}
          <Link href="/verify-email" className="text-primary hover:underline">
            Request a new link
          </Link>
        </p>
      </CardContent>
    </>
  );
}

function RegisterForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Set once the registration was accepted: the form is replaced by the "what happens next" screen
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const searchParams = useSearchParams();
  // Where to land once signed in; carried through the login page. Only safe relative paths survive.
  const nextPath = getSafeNextPath(searchParams?.get('next'));
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      roleType: 'ALUMNI',
    },
  });

  const noteLength = watch('verificationNote')?.length ?? 0;

  const onSubmit = async (data: RegisterFormData) => {
    setIsLoading(true);
    try {
      const enrollmentNumber = data.enrollmentNumber?.trim();
      const verificationNote = data.verificationNote?.trim();
      const response = await authApi.register({
        email: data.email,
        password: data.password,
        fullName: data.fullName,
        batchYear: data.batchYear,
        department: data.department,
        degree: data.degree,
        roleType: data.roleType,
        ...(enrollmentNumber ? { enrollmentNumber } : {}),
        ...(verificationNote ? { verificationNote } : {}),
      });
      // No session exists yet (an administrator has to approve first), so there is nothing to sign in to and nowhere to
      // redirect: tell the person what happens next.
      setSubmittedEmail(response?.data?.data?.email ?? data.email);
    } catch (error: any) {
      const fieldErrors = getApiFieldErrors(error);
      for (const [field, message] of Object.entries(fieldErrors)) {
        if (field in registerSchemaShape) {
          setError(field as keyof RegisterFormData, { type: 'server', message });
        }
      }
      toast({
        variant: 'destructive',
        title: 'Registration failed',
        description: Object.keys(fieldErrors).length
          ? 'Please fix the highlighted fields.'
          : getApiErrorMessage(error, 'Something went wrong. Please try again.'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen">
      {/* Left Panel - Branding */}
      <div className="relative hidden w-1/2 lg:block">
        <Image
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRJLheGW1Jq6n3IMGtta80GBzk0IbB5NQMrbmKTCBCk_kVXPufjO894SK8YfCuz3tx6grTBQTA7gFog7d1AfuPuT5qRbqB-j3EkDqIF8eVStgvdlGAMcg4heMjtdvcj_XrXJJ3hXs2-kl_0Ho7V09OozP-A_D3F8_N-ZhIKQbiXTpyaCAxNrfoGtQX67NVatG_6bTmLXXaIhiBL_42OwBIjWLNIJYRlSXRujV9OlsVF5ixuswtyhC1QUX30-c-cwnAnhD1BZbD8qD6"
          alt="University Campus"
          fill
          priority
          className="object-cover"
          sizes="50vw"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#002045]/90 via-[#1a365d]/80 to-transparent" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12">
          <Link href="/" className="font-headline text-3xl italic text-white">
            AIEM Connect
          </Link>
          <div className="max-w-md space-y-6">
            <h1 className="font-headline text-5xl leading-tight text-white">
              Begin your <span className="italic text-amber-400">Journey.</span>
            </h1>
            <p className="text-lg leading-relaxed text-white/80 font-body">
              Reconnect with fellow alumni of the college. Build connections, discover opportunities, and stay close to the community.
            </p>
          </div>
          <p className="text-sm text-white/60 font-label">© {new Date().getFullYear()} AIEM Connect</p>
        </div>
      </div>

      {/* Right Panel - Form */}
      <div className="flex w-full flex-col items-center justify-center bg-slate-50 px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <Link href="/" className="font-headline text-2xl italic text-primary">
              AIEM Connect
            </Link>
          </div>

          <Card className="border-slate-200 shadow-xl shadow-primary/5">
            {submittedEmail ? (
              <WhatHappensNext email={submittedEmail} loginHref={buildLoginHref(nextPath)} />
            ) : (
            <>
            <CardHeader className="text-center">
              <CardTitle className="font-headline text-3xl text-primary">Create Account</CardTitle>
              <CardDescription className="font-body">Join the alumni network today</CardDescription>
            </CardHeader>
            <CardContent>
            <p className="mb-4 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 font-body">
              An administrator checks every registration to make sure you are an alumnus of the college. You can use the
              network once your registration is approved.
            </p>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  placeholder="John Doe"
                  {...register('fullName')}
                  disabled={isLoading}
                />
                {errors.fullName && (
                  <p className="text-sm text-destructive">{errors.fullName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  {...register('email')}
                  disabled={isLoading}
                />
                {errors.email && (
                  <p className="text-sm text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Batch Year</Label>
                  <Select onValueChange={(value) => setValue('batchYear', parseInt(value))}>
                    <SelectTrigger aria-label="Batch year">
                      <SelectValue placeholder="Select year" />
                    </SelectTrigger>
                    <SelectContent>
                      {batchYears.map((year) => (
                        <SelectItem key={year} value={year.toString()}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.batchYear && (
                    <p className="text-sm text-destructive">{errors.batchYear.message}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Degree</Label>
                  <Select onValueChange={(value) => setValue('degree', value)}>
                    <SelectTrigger aria-label="Degree">
                      <SelectValue placeholder="Select degree" />
                    </SelectTrigger>
                    <SelectContent>
                      {degrees.map((degree) => (
                        <SelectItem key={degree} value={degree}>
                          {degree}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.degree && (
                    <p className="text-sm text-destructive">{errors.degree.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Department</Label>
                <Select onValueChange={(value) => setValue('department', value)}>
                  <SelectTrigger aria-label="Department">
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept} value={dept}>
                        {dept}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.department && (
                  <p className="text-sm text-destructive">{errors.department.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    {...register('password')}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-destructive">{errors.password.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    {...register('confirmPassword')}
                    disabled={isLoading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? 'Hide confirmation password' : 'Show confirmation password'}
                    aria-pressed={showConfirmPassword}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="enrollmentNumber">Enrolment / roll number at the college (optional)</Label>
                <Input
                  id="enrollmentNumber"
                  autoComplete="off"
                  maxLength={ENROLMENT_MAX}
                  placeholder="e.g. AIEM/2019/042"
                  {...register('enrollmentNumber')}
                  disabled={isLoading}
                />
                {errors.enrollmentNumber && (
                  <p className="text-sm text-destructive">{errors.enrollmentNumber.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="verificationNote">Anything that helps us verify you (optional)</Label>
                <Textarea
                  id="verificationNote"
                  rows={3}
                  maxLength={NOTE_MAX}
                  placeholder="e.g. B.Tech Computer Science, 2015 to 2019. Prof. Rao taught my batch."
                  {...register('verificationNote')}
                  disabled={isLoading}
                />
                <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                  <span>Your programme and year, or the name of a contact who knows you.</span>
                  <span className="shrink-0" aria-live="polite">
                    {noteLength} / {NOTE_MAX}
                  </span>
                </div>
                {errors.verificationNote && (
                  <p className="text-sm text-destructive">{errors.verificationNote.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating account...
                  </>
                ) : (
                  'Create Account'
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground font-body">
              Already have an account?{' '}
              <Link href={buildLoginHref(nextPath)} className="text-primary hover:underline font-medium">
                Sign in
              </Link>
            </p>
          </CardContent>
            </>
            )}
        </Card>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}
