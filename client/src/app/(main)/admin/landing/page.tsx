'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { landingApi, type LandingBlock, type LandingBlockType } from '@/lib/engagement';

type Field = { key: string; label: string; kind: 'text' | 'textarea' | 'number' };
const FIELDS: Record<LandingBlockType, Field[]> = {
  HERO: [
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'subtitle', label: 'Subtitle', kind: 'text' },
    { key: 'ctaText', label: 'Button text', kind: 'text' },
    { key: 'ctaHref', label: 'Button link', kind: 'text' },
  ],
  TEXT: [
    { key: 'heading', label: 'Heading', kind: 'text' },
    { key: 'body', label: 'Body', kind: 'textarea' },
  ],
  IMAGE: [
    { key: 'imageUrl', label: 'Image URL', kind: 'text' },
    { key: 'caption', label: 'Caption', kind: 'text' },
  ],
  STATS: [],
  CTA: [
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'buttonText', label: 'Button text', kind: 'text' },
    { key: 'buttonHref', label: 'Button link', kind: 'text' },
  ],
  HTML: [
    { key: 'html', label: 'HTML', kind: 'textarea' },
    { key: 'css', label: 'CSS', kind: 'textarea' },
    { key: 'height', label: 'Height (px)', kind: 'number' },
  ],
};
const TYPES = Object.keys(FIELDS) as LandingBlockType[];

export default function AdminLandingPage() {
  const { toast } = useToast();
  const [blocks, setBlocks] = React.useState<LandingBlock[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newType, setNewType] = React.useState<LandingBlockType>('HERO');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      setBlocks(await landingApi.adminBlocks());
    } catch (err) {
      toast({ title: 'Could not load the page', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const add = async () => {
    setBusy(true);
    try {
      const created = await landingApi.create({ type: newType, config: {} });
      setBlocks((b) => [...b, created]);
    } catch (err) {
      toast({ title: 'Could not add block', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const setField = (id: string, key: string, value: string | number) =>
    setBlocks((b) => b.map((bl) => (bl.id === id ? { ...bl, config: { ...bl.config, [key]: value } } : bl)));

  const saveBlock = async (block: LandingBlock) => {
    try {
      await landingApi.update(block.id, { config: block.config });
      toast({ title: 'Block saved' });
    } catch (err) {
      toast({ title: 'Save failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  const togglePublish = async (block: LandingBlock) => {
    try {
      const updated = await landingApi.update(block.id, { isPublished: !block.isPublished });
      setBlocks((b) => b.map((bl) => (bl.id === block.id ? { ...bl, isPublished: updated.isPublished } : bl)));
    } catch (err) {
      toast({ title: 'Update failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this block?')) return;
    try {
      await landingApi.remove(id);
      setBlocks((b) => b.filter((bl) => bl.id !== id));
    } catch (err) {
      toast({ title: 'Delete failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= blocks.length) return;
    const reordered = [...blocks];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    setBlocks(reordered);
    try {
      await landingApi.reorder(reordered.map((b) => b.id));
    } catch (err) {
      toast({ title: 'Reorder failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
      void load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Landing page builder</h1>
          <p className="text-muted-foreground">Add, arrange and edit the sections shown on the public home page.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={newType} onChange={(e) => setNewType(e.target.value as LandingBlockType)}>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <Button onClick={add} disabled={busy}><Plus className="mr-2 h-4 w-4" aria-hidden /> Add block</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" /></div>
      ) : blocks.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">No custom blocks yet. Add one to customise the landing page.</CardContent></Card>
      ) : (
        <div className="space-y-4">
          {blocks.map((block, i) => (
            <Card key={block.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{block.type}</Badge>
                    {!block.isPublished && <Badge variant="outline">Hidden</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" onClick={() => void move(i, -1)} disabled={i === 0} aria-label="Move up"><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                    <Button size="icon" variant="ghost" onClick={() => void move(i, 1)} disabled={i === blocks.length - 1} aria-label="Move down"><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                    <Button size="icon" variant="ghost" onClick={() => void togglePublish(block)} aria-label={block.isPublished ? 'Hide' : 'Show'}>
                      {block.isPublished ? <Eye className="h-4 w-4" aria-hidden /> : <EyeOff className="h-4 w-4" aria-hidden />}
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => void remove(block.id)} aria-label="Delete"><Trash2 className="h-4 w-4 text-destructive" aria-hidden /></Button>
                  </div>
                </div>

                {FIELDS[block.type].length === 0 ? (
                  <p className="text-sm text-muted-foreground">This block shows live platform stats — no configuration needed.</p>
                ) : (
                  <div className="grid gap-3">
                    {FIELDS[block.type].map((f) => (
                      <div key={f.key} className="space-y-1">
                        <Label htmlFor={`${block.id}-${f.key}`}>{f.label}</Label>
                        {f.kind === 'textarea' ? (
                          <Textarea id={`${block.id}-${f.key}`} rows={f.key === 'html' ? 8 : 4} value={String(block.config[f.key] ?? '')} onChange={(e) => setField(block.id, f.key, e.target.value)} className={f.key === 'html' || f.key === 'css' ? 'font-mono text-xs' : undefined} />
                        ) : (
                          <Input id={`${block.id}-${f.key}`} type={f.kind === 'number' ? 'number' : 'text'} value={String(block.config[f.key] ?? '')} onChange={(e) => setField(block.id, f.key, f.kind === 'number' ? Number(e.target.value) : e.target.value)} />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {FIELDS[block.type].length > 0 && <Button size="sm" onClick={() => void saveBlock(block)}>Save block</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
