'use client';

import * as React from 'react';
import { Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { requirementsApi, REQUIREMENT_CATEGORIES, type CollegeRequirement, type RequirementCategory, type RequirementResponse } from '@/lib/engagement';

const selectCls = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

export default function AdminRequirementsPage() {
  const { toast } = useToast();
  const [items, setItems] = React.useState<CollegeRequirement[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [responses, setResponses] = React.useState<RequirementResponse[]>([]);

  // create form
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<RequirementCategory>('HARDWARE');
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      // Admin list: pull each status so the board shows everything.
      const [open, fulfilled, closed] = await Promise.all([
        requirementsApi.list({ status: 'OPEN', limit: 50 }),
        requirementsApi.list({ status: 'FULFILLED', limit: 50 }),
        requirementsApi.list({ status: 'CLOSED', limit: 50 }),
      ]);
      setItems([...(open.items ?? []), ...(fulfilled.items ?? []), ...(closed.items ?? [])]);
    } catch (err) {
      toast({ title: 'Could not load requirements', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!title.trim() || !description.trim()) return;
    setSaving(true);
    try {
      await requirementsApi.create({ title: title.trim(), description: description.trim(), category });
      toast({ title: 'Requirement posted', description: 'Alumni have been notified.' });
      setCreateOpen(false);
      setTitle(''); setDescription(''); setCategory('HARDWARE');
      void load();
    } catch (err) {
      toast({ title: 'Could not post', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (r: CollegeRequirement, status: CollegeRequirement['status']) => {
    try {
      await requirementsApi.update(r.id, { status });
      setItems((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)));
    } catch (err) {
      toast({ title: 'Update failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this requirement?')) return;
    try {
      await requirementsApi.remove(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      toast({ title: 'Delete failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  const toggleOffers = async (r: CollegeRequirement) => {
    if (expanded === r.id) { setExpanded(null); return; }
    setExpanded(r.id);
    setResponses([]);
    try {
      const full = await requirementsApi.get(r.id);
      setResponses(full.responses ?? []);
    } catch (err) {
      toast({ title: 'Could not load offers', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  const review = async (responseId: string, accept: boolean) => {
    try {
      await requirementsApi.reviewResponse(responseId, accept);
      setResponses((prev) => prev.map((x) => (x.id === responseId ? { ...x, status: accept ? 'ACCEPTED' : 'DECLINED' } : x)));
      toast({ title: accept ? 'Offer accepted' : 'Offer declined' });
    } catch (err) {
      toast({ title: 'Action failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">College Requirements</h1>
          <p className="text-muted-foreground">Post what the college needs; review alumni offers to help.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus className="mr-2 h-4 w-4" aria-hidden /> Post requirement</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No requirements yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <Badge variant="secondary">{r.category}</Badge>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                    <h3 className="font-semibold">{r.title}</h3>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{r.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select className={selectCls} value={r.status} onChange={(e) => void setStatus(r, e.target.value as CollegeRequirement['status'])} aria-label="Status">
                      <option value="OPEN">Open</option>
                      <option value="FULFILLED">Fulfilled</option>
                      <option value="CLOSED">Closed</option>
                    </select>
                    <Button size="icon" variant="ghost" onClick={() => void remove(r.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-destructive" aria-hidden /></Button>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => void toggleOffers(r)}>
                  {expanded === r.id ? 'Hide offers' : `View offers (${r._count?.responses ?? 0})`}
                </Button>
                {expanded === r.id && (
                  <div className="space-y-2 rounded-md border p-3">
                    {responses.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No offers yet.</p>
                    ) : (
                      responses.map((resp) => (
                        <div key={resp.id} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{resp.user?.fullName ?? 'Member'} <Badge variant="outline" className="ml-1">{resp.status}</Badge></p>
                            <p className="text-sm text-muted-foreground">{resp.message}</p>
                          </div>
                          {resp.status === 'OFFERED' && (
                            <div className="flex shrink-0 gap-1">
                              <Button size="icon" variant="ghost" onClick={() => void review(resp.id, true)} aria-label="Accept"><Check className="h-4 w-4 text-success" aria-hidden /></Button>
                              <Button size="icon" variant="ghost" onClick={() => void review(resp.id, false)} aria-label="Decline"><X className="h-4 w-4 text-destructive" aria-hidden /></Button>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => !saving && setCreateOpen(o)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Post a requirement</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="req-title">Title</Label><Input id="req-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="req-cat">Category</Label>
              <select id="req-cat" className={`${selectCls} w-full h-10`} value={category} onChange={(e) => setCategory(e.target.value as RequirementCategory)}>
                {REQUIREMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="req-desc">Description</Label><Textarea id="req-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={create} disabled={saving || !title.trim() || !description.trim()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Post</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
