'use client';

import * as React from 'react';
import Link from 'next/link';
import { Loader2, Plus, Handshake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { mediaSrc } from '@/lib/social';
import { getInitials } from '@/lib/utils';
import { referralsApi, type ReferralRequest } from '@/lib/engagement';
import { RequestReferralDialog } from '@/components/referrals/RequestReferralDialog';

const STATUS: Record<string, string> = { PENDING: 'bg-gold text-gold-foreground', ACCEPTED: 'bg-success text-white', DECLINED: 'bg-muted text-muted-foreground' };

export default function ReferralsPage() {
  const { toast } = useToast();
  const [tab, setTab] = React.useState<'received' | 'sent'>('received');
  const [items, setItems] = React.useState<ReferralRequest[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [askOpen, setAskOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = tab === 'received' ? await referralsApi.received({ limit: 50 }) : await referralsApi.sent({ limit: 50 });
      setItems(res.items ?? []);
    } catch (err) {
      toast({ title: 'Could not load referrals', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [tab, toast]);

  React.useEffect(() => { void load(); }, [load]);

  const respond = async (id: string, accept: boolean) => {
    setBusyId(id);
    try {
      const updated = await referralsApi.respond(id, accept);
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, status: updated.status } : x)));
      toast({ title: accept ? 'Referral accepted' : 'Referral declined' });
    } catch (err) {
      toast({ title: 'Action failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="container max-w-3xl space-y-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-headline text-3xl text-primary">Referrals</h1>
          <p className="text-muted-foreground">Ask alumni to refer you, and respond to requests you receive.</p>
        </div>
        <Button onClick={() => setAskOpen(true)}><Plus className="mr-2 h-4 w-4" aria-hidden /> Request a referral</Button>
      </div>

      <div role="tablist" className="flex w-fit gap-1 rounded-lg border bg-card p-1">
        {(['received', 'sent'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{k}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">{tab === 'received' ? 'No referral requests yet.' : 'You haven’t requested any referrals yet.'}</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const person = tab === 'received' ? r.requester : r.target;
            return (
              <Card key={r.id}>
                <CardContent className="flex items-start gap-3 p-4">
                  <Avatar className="h-10 w-10"><AvatarImage src={mediaSrc(person?.profilePhotoUrl) || undefined} alt="" /><AvatarFallback>{getInitials(person?.fullName || '?')}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <Link href={`/profile/${person?.id}`} className="font-medium hover:underline">{person?.fullName ?? 'Member'}</Link>
                      <span className="text-muted-foreground"> · {r.company}</span>
                      <Badge className={`ml-2 ${STATUS[r.status]}`}>{r.status}</Badge>
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{r.message}</p>
                    {tab === 'received' && r.status === 'PENDING' && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" disabled={busyId === r.id} onClick={() => void respond(r.id, true)}><Handshake className="mr-1 h-4 w-4" aria-hidden /> Accept</Button>
                        <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => void respond(r.id, false)}>Decline</Button>
                      </div>
                    )}
                    {tab === 'received' && r.status === 'ACCEPTED' && (
                      <Button asChild size="sm" variant="outline" className="mt-2"><Link href={`/messages?u=${person?.id}`}>Message</Link></Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RequestReferralDialog open={askOpen} onOpenChange={setAskOpen} onCreated={() => { setTab('sent'); void load(); }} />
    </div>
  );
}
