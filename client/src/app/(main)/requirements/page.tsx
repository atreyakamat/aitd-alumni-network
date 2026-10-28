'use client';

import * as React from 'react';
import { HandHeart, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { requirementsApi, type CollegeRequirement } from '@/lib/engagement';

export default function RequirementsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = React.useState<CollegeRequirement[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [offering, setOffering] = React.useState<CollegeRequirement | null>(null);
  const [message, setMessage] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await requirementsApi.list({ limit: 50 });
      setItems(res.items ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load requirements.'));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const submitOffer = async () => {
    if (!offering || !message.trim()) return;
    setSubmitting(true);
    try {
      await requirementsApi.respond(offering.id, message.trim());
      toast({ title: 'Offer sent', description: 'The college team will be in touch.' });
      setOffering(null);
      setMessage('');
      void load();
    } catch (err) {
      toast({ title: 'Could not send your offer', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-4xl space-y-6 py-6">
      <div>
        <h1 className="font-headline text-3xl text-primary">How you can help</h1>
        <p className="text-muted-foreground">The college is looking for support from alumni — hardware, software, expertise or sponsorship.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" /></div>
      ) : error ? (
        <Card><CardContent className="space-y-3 py-10 text-center"><p className="text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></CardContent></Card>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No open requirements right now. Check back soon.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="secondary">{r.category}</Badge>
                    {r.status !== 'OPEN' && <Badge variant="outline">{r.status}</Badge>}
                  </div>
                  <h3 className="font-semibold">{r.title}</h3>
                  <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{r.description}</p>
                </div>
                {user && (
                  <Button className="shrink-0" disabled={r.hasResponded || r.status !== 'OPEN'} onClick={() => { setOffering(r); setMessage(''); }}>
                    <HandHeart className="mr-2 h-4 w-4" aria-hidden />
                    {r.hasResponded ? 'Offered' : 'I can help'}
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={offering !== null} onOpenChange={(o) => !o && !submitting && setOffering(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Offer to help</DialogTitle>
            <DialogDescription>{offering?.title}</DialogDescription>
          </DialogHeader>
          <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder="How can you help? (e.g. I can donate 10 PCs / mentor a team / sponsor…)" maxLength={2000} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOffering(null)} disabled={submitting}>Cancel</Button>
            <Button onClick={submitOffer} disabled={submitting || !message.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Send offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
