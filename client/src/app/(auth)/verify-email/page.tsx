'use client';

import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { authApi, getApiErrorCode, getApiErrorMessage } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BRAND } from '@/lib/brand';

type Stage = 'confirm' | 'verified' | 'newLink';

/**
 * Said when the server sends no message of its own. Verifying the address does NOT make the person a member: an administrator
 * still has to approve the registration, so this never says the account can be used.
 */
const FALLBACK_VERIFIED_MESSAGE =
  'Your email address is verified. An administrator now checks your registration; you will be told by e-mail when it is approved.';

/**
 * The page the link in the registration e-mail opens.
 *
 * Confirming needs the password chosen at registration. That is what stops somebody who registered YOUR address
 * with THEIR password from getting you to verify their account: the link alone completes nothing.
 */
function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') || '';

  const [stage, setStage] = useState<Stage>(token ? 'confirm' : 'newLink');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the server says happens next (it differs for somebody who was approved already)
  const [verifiedMessage, setVerifiedMessage] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) {
      setError('Enter the password you chose when you registered.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const response = await authApi.verifyEmail(token, password);
      const message = response?.data?.data?.message;
      setVerifiedMessage(typeof message === 'string' && message.trim() ? message : null);
      setPassword('');
      setStage('verified');
    } catch (err) {
      const code = getApiErrorCode(err);
      if (code === 'INVALID_TOKEN') {
        setStage('newLink');
      } else if (code === 'VERIFY_PASSWORD_INVALID') {
        setError('That is not the password this account was registered with. Try again, or ignore this e-mail if you did not register.');
      } else {
        setError(getApiErrorMessage(err, 'Could not verify your email address. Please try again.'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const sendNewLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSending(true);
    setSentMessage(null);
    try {
      const response = await authApi.resendVerification(email.trim());
      setSentMessage(response.data?.data?.message ?? 'If that address has an unverified account, a new verification link has been sent.');
    } catch (err) {
      setSentMessage(getApiErrorMessage(err, 'Could not send a new link. Please try again in a moment.'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <Card className="w-full max-w-md">
        {stage === 'verified' && (
          <>
            <CardHeader>
              <CardTitle>Email verified</CardTitle>
              <CardDescription>{verifiedMessage ?? FALLBACK_VERIFIED_MESSAGE}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </CardContent>
          </>
        )}

        {stage === 'confirm' && (
          <>
            <CardHeader>
              <CardTitle>Confirm your email address</CardTitle>
              <CardDescription>
                Enter the password you chose when you registered to finish verifying your account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={confirm} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? 'Confirming...' : 'Confirm email'}
                </Button>
              </form>
              <p className="mt-4 text-sm text-slate-600">
                If you did not create an account on {BRAND.appName}, you can ignore the e-mail and close this page.
                Nothing is changed until the right password is entered.
              </p>
            </CardContent>
          </>
        )}

        {stage === 'newLink' && (
          <>
            <CardHeader>
              <CardTitle>{token ? 'This link is not valid' : 'Get a verification link'}</CardTitle>
              <CardDescription>
                {token
                  ? 'This verification link is invalid or has expired. Enter your email address and we will send a new one.'
                  : 'Enter the email address you registered with and we will send you a verification link.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={sendNewLink} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </div>
                {sentMessage && (
                  <p role="status" className="text-sm text-slate-700">
                    {sentMessage}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isSending}>
                  {isSending ? 'Sending...' : 'Send a new link'}
                </Button>
              </form>
            </CardContent>
          </>
        )}

        {stage !== 'verified' && (
          <div className="px-6 pb-6 text-sm">
            <Link href="/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
