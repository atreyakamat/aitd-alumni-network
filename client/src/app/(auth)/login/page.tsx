'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { authApi, twoFactorApi, isTwoFactorChallenge, getApiErrorCode, getApiErrorMessage, getApprovalState, type ApprovalState } from '@/lib/api';
import { getAuthErrorMessage, shouldRestart2FA } from '@/lib/auth';
import { buildRegisterHref, getSafeNextPath } from '@/lib/public-paths';
import { parseApprovalParam } from '@/lib/approval';
import { ApprovalNotice } from '@/components/auth/ApprovalNotice';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

function LoginContent() {
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorToken, setTwoFactorToken] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);
  // Set when the API refused a session because the e-mail address is not verified yet
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const { setAuthData, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const registered = searchParams?.get('registered');
  // Why the platform will not let this person in: an administrator has not approved the registration (yet), or has not approved
  // it at all. Set by a refused sign-in below, or by ?approval= when a running session was ended because the approval was taken back.
  const [approvalNotice, setApprovalNotice] = useState<ApprovalState | null>(() => parseApprovalParam(searchParams?.get('approval')));
  // Where to go after signing in; only same-origin relative paths are honoured (handles both ?next= and ?redirect=).
  const afterLoginPath = getSafeNextPath(searchParams?.get('next') ?? searchParams?.get('redirect')) ?? '/dashboard';

  // A visitor who is already signed in (e.g. redirected here by the edge gate because the session
  // hint cookie expired) goes straight on to where they were headed.
  useEffect(() => {
    if (isAuthenticated) router.replace(afterLoginPath);
  }, [isAuthenticated, router, afterLoginPath]);


  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setApprovalNotice(null);
    try {
      const response = await authApi.login(data);
      const result = response.data.data;

      if (isTwoFactorChallenge(result)) {
        setRequires2FA(true);
        setOtpCode('');
        setTwoFactorToken(result.twoFactorToken);
        toast({
          title: 'Verification Required',
          description: 'A verification code has been sent to your email.',
        });
      } else {
        setAuthData(result);
        toast({
          title: 'Welcome back!',
          description: 'You have successfully logged in.',
        });
        router.push(afterLoginPath);
      }
    } catch (error: any) {
      const approval = getApprovalState(error);
      if (approval) {
        setUnverifiedEmail(null);
        setApprovalNotice(approval);
        return;
      }
      if (getApiErrorCode(error) === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(data.email);
        setResendNotice(null);
        return;
      }
      setUnverifiedEmail(null);
      toast({
        variant: 'destructive',
        title: 'Login failed',
        description: getApiErrorMessage(error, 'Invalid credentials. Please try again.'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resendVerification = async () => {
    if (!unverifiedEmail) return;
    setIsResending(true);
    try {
      const response = await authApi.resendVerification(unverifiedEmail);
      setResendNotice(
        response.data?.data?.message ?? 'If that address has an unverified account, a new verification link has been sent.'
      );
    } catch (error: any) {
      setResendNotice(getApiErrorMessage(error, 'Could not send a new link. Please try again in a moment.'));
    } finally {
      setIsResending(false);
    }
  };

  const verify2FA = async () => {
    if (!otpCode || otpCode.length !== 6) {
      toast({
        variant: 'destructive',
        title: 'Invalid Code',
        description: 'Please enter a 6-digit verification code.',
      });
      return;
    }

    if (!twoFactorToken) {
      setRequires2FA(false);
      return;
    }

    setIsVerifying2FA(true);
    try {
      const response = await twoFactorApi.verify2FA(twoFactorToken, otpCode);
      const result = response.data.data;
      setAuthData(result);
      toast({
        title: 'Welcome back!',
        description: 'You have successfully logged in.',
      });
      router.push(afterLoginPath);
    } catch (error: any) {
      const approval = getApprovalState(error);
      if (approval) {
        // Back to the sign-in form, where the notice is: there is no session to finish
        setRequires2FA(false);
        setTwoFactorToken(null);
        setOtpCode('');
        setApprovalNotice(approval);
        return;
      }
      toast({
        variant: 'destructive',
        title: 'Verification Failed',
        description: getAuthErrorMessage(error, 'Invalid or expired code. Please try again.'),
      });
      if (shouldRestart2FA(error)) {
        setRequires2FA(false);
        setTwoFactorToken(null);
        setOtpCode('');
      }
    } finally {
      setIsVerifying2FA(false);
    }
  };

  const resend2FA = async () => {
    try {
      if (!twoFactorToken) {
        setRequires2FA(false);
        return;
      }
      await twoFactorApi.resend2FA(twoFactorToken);
      toast({
        title: 'Code Sent',
        description: 'A new verification code has been sent to your email.',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Could not resend code',
        description: getAuthErrorMessage(error, 'Failed to resend code. Please try again.'),
      });
      if (shouldRestart2FA(error)) {
        setRequires2FA(false);
        setTwoFactorToken(null);
        setOtpCode('');
      }
    }
  };

  // 2FA Verification UI
  if (requires2FA) {
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
                Secure <span className="italic text-amber-400">Verification</span>
              </h1>
              <p className="text-lg leading-relaxed text-white/80 font-body">
                Enter the verification code sent to your email to complete sign-in.
              </p>
            </div>
            <p className="text-sm text-white/60 font-label">© {new Date().getFullYear()} AIEM Connect</p>
          </div>
        </div>

        {/* Right Panel - 2FA Form */}
        <div className="flex w-full flex-col items-center justify-center bg-slate-50 px-6 py-12 lg:w-1/2">
          <div className="w-full max-w-md">
            <Card className="border-slate-200 shadow-xl shadow-primary/5">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <ShieldCheck className="h-8 w-8 text-primary" />
                </div>
                <CardTitle className="font-headline text-2xl text-primary">Two-Factor Authentication</CardTitle>
                <CardDescription className="font-body">
                  Enter the 6-digit code sent to your email
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="otp">Verification Code</Label>
                  <Input
                    id="otp"
                    type="text"
                    placeholder="000000"
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    maxLength={6}
                    className="text-center text-2xl tracking-widest"
                    disabled={isVerifying2FA}
                  />
                </div>

                <Button
                  onClick={verify2FA}
                  className="w-full"
                  disabled={isVerifying2FA || otpCode.length !== 6}
                >
                  {isVerifying2FA ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Verify Code'
                  )}
                </Button>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={resend2FA}
                    className="text-sm text-primary hover:underline"
                    disabled={isVerifying2FA}
                  >
                    Didn&apos;t receive the code? Resend
                  </button>
                </div>

                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setRequires2FA(false);
                      setTwoFactorToken(null);
                      setOtpCode('');
                    }}
                    className="text-sm text-muted-foreground hover:underline"
                  >
                    ← Back to login
                  </button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

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
              Welcome back to the <span className="italic text-amber-400">Legacy.</span>
            </h1>
            <p className="text-lg leading-relaxed text-white/80 font-body">
              Sign in to reconnect with fellow scholars, explore opportunities, and shape the future of our community.
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

          {approvalNotice && <ApprovalNotice state={approvalNotice} className="mb-6" />}

          {registered && !approvalNotice && (
            <div className="mb-6 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-700 font-body">
              <p className="font-medium">Registration received.</p>
              <p className="mt-1 text-sm">
                Verify your e-mail with the link we sent you. An administrator then checks that you are an alumnus of the college;
                you can sign in as soon as you are approved, and we will tell you by e-mail.
              </p>
            </div>
          )}

          {unverifiedEmail && (
            <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 font-body">
              <p>
                Please verify your email address before signing in. We sent a link to <strong>{unverifiedEmail}</strong> when you
                registered; open it and confirm with your password.
              </p>
              {resendNotice ? (
                <p className="mt-2 text-sm">{resendNotice}</p>
              ) : (
                <Button type="button" variant="outline" size="sm" className="mt-3" disabled={isResending} onClick={resendVerification}>
                  {isResending ? 'Sending...' : 'Resend verification email'}
                </Button>
              )}
            </div>
          )}

          <Card className="border-slate-200 shadow-xl shadow-primary/5">
            <CardHeader className="text-center">
              <CardTitle className="font-headline text-3xl text-primary">Welcome Back</CardTitle>
              <CardDescription className="font-body">Sign in to your alumni account</CardDescription>
            </CardHeader>
            <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
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

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  'Sign In'
                )}
              </Button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Link href={buildRegisterHref(searchParams?.get('next'))} className="text-primary hover:underline font-medium">
                Sign up
              </Link>
            </p>
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
