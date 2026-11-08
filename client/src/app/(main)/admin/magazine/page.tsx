'use client';

import * as React from 'react';
import { BookOpen, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { mediaSrc } from '@/lib/social';
import { magazineApi, validatePdfFile, type Magazine } from '@/lib/videos';

function UploadDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = React.useState('');
  const [edition, setEdition] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [fileUrl, setFileUrl] = React.useState<string | null>(null);
  const [coverImageUrl, setCoverImageUrl] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = () => {
    setTitle(''); setEdition(''); setDescription(''); setFileUrl(null); setCoverImageUrl(null); setProgress(0); setError(null);
  };

  const onPdf = async (file?: File) => {
    if (!file) return;
    const invalid = validatePdfFile(file);
    if (invalid) return setError(invalid);
    setError(null); setUploading(true); setProgress(0);
    try {
      const { fileUrl: url } = await magazineApi.uploadFile(file, setProgress);
      setFileUrl(url);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not upload the PDF.'));
    } finally {
      setUploading(false);
    }
  };

  const onCover = async (file?: File) => {
    if (!file) return;
    try {
      const { url } = await magazineApi.uploadCover(file);
      setCoverImageUrl(url);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not upload the cover.'));
    }
  };

  const canSubmit = title.trim().length > 0 && Boolean(fileUrl) && !uploading && !submitting;

  const submit = async () => {
    if (!canSubmit || !fileUrl) return;
    setSubmitting(true); setError(null);
    try {
      await magazineApi.create({ title: title.trim(), edition: edition.trim() || undefined, description: description.trim() || undefined, fileUrl, coverImageUrl });
      toast({ title: 'Magazine published' });
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not publish the magazine.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!uploading && !submitting) { if (!o) reset(); onOpenChange(o); } }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Publish a magazine edition</DialogTitle>
          <DialogDescription>Upload the PDF and an optional cover. The community will be notified.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mag-title">Title</Label>
            <Input id="mag-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Agnelite" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mag-edition">Edition (optional)</Label>
            <Input id="mag-edition" value={edition} onChange={(e) => setEdition(e.target.value)} placeholder="e.g. Vol 12 • 2026" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mag-desc">Description (optional)</Label>
            <Textarea id="mag-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Magazine PDF</Label>
            {fileUrl ? (
              <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-primary">PDF uploaded ✓</p>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" asChild disabled={uploading}>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" aria-hidden /> {uploading ? 'Uploading…' : 'Choose PDF (max 25 MB)'}
                    <input type="file" accept="application/pdf" className="sr-only" disabled={uploading} onChange={(e) => { void onPdf(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                </Button>
                {uploading && <Progress value={progress} aria-label="Upload progress" />}
              </>
            )}
          </div>
          <div className="space-y-2">
            <Label>Cover image (optional)</Label>
            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" aria-hidden /> {coverImageUrl ? 'Cover added — replace' : 'Choose a cover image'}
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" onChange={(e) => { void onCover(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </Button>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={uploading || submitting}>Cancel</Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function AdminMagazinePage() {
  const { toast } = useToast();
  const [items, setItems] = React.useState<Magazine[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [open, setOpen] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await magazineApi.list({ all: true, limit: 50 });
      setItems(res.items ?? []);
    } catch (err) {
      toast({ title: 'Could not load magazines', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm('Delete this magazine edition permanently?')) return;
    setBusyId(id);
    try {
      await magazineApi.remove(id);
      toast({ title: 'Magazine deleted' });
      setItems((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      toast({ title: 'Delete failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">College Magazine</h1>
          <p className="text-muted-foreground">Publish and manage magazine editions.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" aria-hidden /> Publish edition</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No editions yet.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((m) => (
            <Card key={m.id}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded bg-muted">
                  {m.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user upload
                    <img src={mediaSrc(m.coverImageUrl)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center"><BookOpen className="h-6 w-6 text-primary/40" aria-hidden /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium">{m.title}</h3>
                  {m.edition && <p className="text-sm text-muted-foreground">{m.edition}</p>}
                  <a href={mediaSrc(m.fileUrl)} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline">Open PDF</a>
                </div>
                <Button size="icon" variant="ghost" disabled={busyId === m.id} onClick={() => void remove(m.id)} aria-label="Delete edition">
                  <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <UploadDialog open={open} onOpenChange={setOpen} onSuccess={load} />
    </div>
  );
}
