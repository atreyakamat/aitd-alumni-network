'use client';

import * as React from 'react';
import { Loader2, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { mediaSrc } from '@/lib/social';
import { getInitials } from '@/lib/utils';
import { referralsApi, type Referrer } from '@/lib/engagement';

export function RequestReferralDialog({
  open,
  onOpenChange,
  defaultCompany = '',
  jobId = null,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultCompany?: string;
  jobId?: string | null;
  onCreated?: () => void;
}) {
  const { toast } = useToast();
  const [company, setCompany] = React.useState(defaultCompany);
  const [people, setPeople] = React.useState<Referrer[] | null>(null);
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState('');
  const [searching, setSearching] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCompany(defaultCompany);
      setPeople(null);
      setTargetId(null);
      setMessage('');
    }
  }, [open, defaultCompany]);

  const search = async () => {
    if (company.trim().length < 2) return;
    setSearching(true);
    setPeople(null);
    try {
      setPeople(await referralsApi.findReferrers(company.trim()));
    } catch (err) {
      toast({ title: 'Search failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    if (!targetId || !message.trim()) return;
    setSubmitting(true);
    try {
      await referralsApi.create({ targetId, company: company.trim(), message: message.trim(), jobId });
      toast({ title: 'Referral requested', description: 'They’ll be notified and can accept to connect.' });
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      toast({ title: 'Could not send the request', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Ask an alum for a referral</DialogTitle>
          <DialogDescription>Find alumni at a company and ask one of them to refer you.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ref-company">Company</Label>
            <div className="flex gap-2">
              <Input id="ref-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Acme Corp"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
              <Button type="button" variant="secondary" onClick={() => void search()} disabled={searching || company.trim().length < 2}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
              </Button>
            </div>
          </div>

          {people && (
            people.length === 0 ? (
              <p className="text-sm text-muted-foreground">No alumni found at that company yet.</p>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1" role="radiogroup" aria-label="Alumni to ask">
                {people.map((p) => (
                  <li key={p.user.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={targetId === p.user.id}
                      onClick={() => setTargetId(p.user.id)}
                      className={`flex w-full items-center gap-3 rounded-md p-2 text-left ${targetId === p.user.id ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted'}`}
                    >
                      <Avatar className="h-8 w-8"><AvatarImage src={mediaSrc(p.user.profilePhotoUrl) || undefined} alt="" /><AvatarFallback className="text-xs">{getInitials(p.user.fullName)}</AvatarFallback></Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{p.user.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{p.role}{p.isCurrent ? ' (current)' : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          )}

          {targetId && (
            <div className="space-y-1.5">
              <Label htmlFor="ref-msg">Your message</Label>
              <Textarea id="ref-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={2000} placeholder="Introduce yourself and the role you're interested in." />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || !targetId || !message.trim()}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
