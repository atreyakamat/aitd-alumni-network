'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Heart, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { donationApi } from '@/lib/api';
import { getPaymentErrorMessage, openRazorpayCheckout } from '@/lib/payments';
import { buildLoginHref } from '@/lib/public-paths';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/lib/utils';

const PRESET_AMOUNTS = [500, 1000, 2500, 5000, 10000];
const DEFAULT_AMOUNT = 1000;
/** The same bounds as the server (MIN_AMOUNT_INR / MAX_AMOUNT_INR in utils/razorpay.ts and the field limits in donationService.ts). */
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 1_000_000;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_MESSAGE_LENGTH = 1000;
const EMAIL_PATTERN = /^[^\s@,;<>()[\]\\"]+@[^\s@,;<>()[\]\\"]+\.[^\s@,;<>()[\]\\"]+$/;

type AmountChoice = number | 'custom';

/**
 * What a VISITOR sees on /donations: the donation form and nothing else. Alumni donate as guests, without an account, so
 * `POST /donations/order` and `/donations/verify` are the two API routes open to visitors; the donor wall, the leaderboard,
 * chapter totals and statistics are members only and are not requested (a 401 would show errors).
 *
 * Name, e-mail, message and "anonymously" are sent with the order and stored server-side; the receipt is e-mailed to the
 * given address. Only the three Razorpay fields go to the verify call.
 */
export function GuestDonationForm() {
  const { toast } = useToast();
  const [choice, setChoice] = useState<AmountChoice>(DEFAULT_AMOUNT);
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [donating, setDonating] = useState(false);
  const [thanks, setThanks] = useState<{ amount: number; email: string | null } | null>(null);

  const amount = choice === 'custom' ? Number(customAmount) : choice;
  const amountIsValid = Number.isInteger(amount) && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT;

  const reset = () => {
    setChoice(DEFAULT_AMOUNT);
    setCustomAmount('');
    setDonorName('');
    setDonorEmail('');
    setMessage('');
    setAnonymous(false);
    setEmailError(null);
    setThanks(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (donating) return;
    if (!amountIsValid) {
      toast({
        title: 'Enter a donation amount',
        description: `Whole rupees, from ${formatCurrency(MIN_AMOUNT)} to ${formatCurrency(MAX_AMOUNT)}.`,
        variant: 'destructive',
      });
      return;
    }
    const email = donorEmail.trim();
    if (email && !EMAIL_PATTERN.test(email)) {
      setEmailError('Enter a valid e-mail address, or leave it empty.');
      return;
    }
    setEmailError(null);

    const name = donorName.trim();
    setDonating(true);
    try {
      const response = await donationApi.createOrder({
        amount,
        isAnonymous: anonymous,
        donorName: name || undefined,
        donorEmail: email || undefined,
        message: message.trim() || undefined,
      });
      const order = response.data.data;

      await openRazorpayCheckout(order, {
        description: 'Donation to Alumni Network',
        prefill: name || email ? { name: name || undefined, email: email || undefined } : undefined,
        onDismiss: () => setDonating(false),
        onSuccess: async (verification) => {
          try {
            await donationApi.verifyPayment(verification);
            setThanks({ amount, email: email || null });
            toast({
              title: 'Thank you!',
              description: email
                ? `Your donation was received. A receipt has been e-mailed to ${email}.`
                : 'Your donation was received. No e-mail address was given, so no receipt was sent.',
            });
          } catch (err) {
            toast({
              title: 'Payment verification failed',
              description: getPaymentErrorMessage(err, 'If you were charged, contact support with your payment ID.'),
              variant: 'destructive',
            });
          } finally {
            setDonating(false);
          }
        },
      });
    } catch (err) {
      toast({
        title: 'Could not start payment',
        description: getPaymentErrorMessage(err, 'Please try again in a moment.'),
        variant: 'destructive',
      });
      setDonating(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-3 text-center">
        <Badge className="border-amber-500/30 bg-amber-500/20 text-amber-700">
          <Sparkles className="mr-1 h-3 w-3" />
          Support Your Alumni Network
        </Badge>
        <h1 className="font-headline text-4xl font-bold text-primary md:text-5xl">Make an Impact Today</h1>
        <p className="text-slate-600">
          Your contribution funds scholarships, events and initiatives that strengthen our alumni community. You do not need an
          account to donate.
        </p>
      </header>

      {thanks ? (
        <Card className="border-0 bg-white shadow-lg">
          <CardContent className="space-y-4 pt-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600" aria-hidden />
            <h2 className="font-headline text-2xl font-bold text-gray-900">Thank you for your donation</h2>
            <p className="text-slate-600">
              {thanks.email
                ? `Your donation of ${formatCurrency(thanks.amount)} was received. A receipt has been e-mailed to ${thanks.email}.`
                : `Your donation of ${formatCurrency(thanks.amount)} was received. No e-mail address was given, so no receipt was sent.`}
            </p>
            <Button variant="outline" onClick={reset}>
              Donate again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 bg-white shadow-lg">
          <CardHeader>
            <CardTitle className="font-headline text-2xl">Your donation</CardTitle>
            <CardDescription>Donating as a guest. Pay securely with Razorpay.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-medium text-gray-700">Amount</legend>
                <div className="flex flex-wrap gap-2">
                  {PRESET_AMOUNTS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant={choice === preset ? 'default' : 'outline'}
                      aria-pressed={choice === preset}
                      className={choice === preset ? 'bg-amber-500 text-white hover:bg-amber-600' : undefined}
                      onClick={() => setChoice(preset)}
                    >
                      {formatCurrency(preset)}
                    </Button>
                  ))}
                </div>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={MIN_AMOUNT}
                  max={MAX_AMOUNT}
                  step={1}
                  aria-label="Other amount in rupees"
                  placeholder="Other amount (in rupees)"
                  value={customAmount}
                  onChange={(e) => {
                    setCustomAmount(e.target.value);
                    setChoice('custom');
                  }}
                  onFocus={() => {
                    if (customAmount) setChoice('custom');
                  }}
                />
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  aria-label="Your name (optional)"
                  placeholder="Your name (optional)"
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="name"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                />
                <div className="space-y-1">
                  <Input
                    type="email"
                    aria-label="E-mail for your receipt (optional)"
                    placeholder="E-mail for your receipt"
                    maxLength={MAX_EMAIL_LENGTH}
                    autoComplete="email"
                    aria-invalid={emailError ? true : undefined}
                    aria-describedby={emailError ? 'guest-donation-email-error' : undefined}
                    value={donorEmail}
                    onChange={(e) => setDonorEmail(e.target.value)}
                  />
                  {emailError && (
                    <p id="guest-donation-email-error" role="alert" className="text-sm text-destructive">
                      {emailError}
                    </p>
                  )}
                </div>
              </div>

              <Textarea
                aria-label="Message (optional)"
                placeholder="A message with your donation (optional)"
                maxLength={MAX_MESSAGE_LENGTH}
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />

              <div className="flex items-center gap-2">
                <input
                  id="guest-donation-anonymous"
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <Label htmlFor="guest-donation-anonymous" className="font-normal text-gray-700">
                  Donate anonymously
                </Label>
              </div>

              <Button type="submit" size="lg" className="w-full bg-amber-500 py-6 text-lg text-white hover:bg-amber-600" disabled={donating}>
                <Heart className="mr-2 h-5 w-5" aria-hidden />
                {amountIsValid ? `Donate ${formatCurrency(amount)}` : 'Donate'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link href={buildLoginHref('/donations')} className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
