'use client';

import * as React from 'react';
import { Loader2, Mail, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';
import { AdminErrorState } from '@/components/admin/AdminErrorState';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { digestApi, type DigestSettings, type DigestSections } from '@/lib/engagement';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SECTION_LABELS: Record<keyof DigestSections, string> = {
  nearbyAlumni: 'New alumni this week',
  jobs: 'New jobs',
  events: 'Upcoming events',
  videos: 'New videos',
  requirements: 'Open requirements',
};
const selectCls = 'h-10 rounded-md border border-input bg-background px-3 text-sm';

export default function CommunicationsPage() {
  const { toast } = useToast();
  const [settings, setSettings] = React.useState<DigestSettings | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [sending, setSending] = React.useState<'test' | 'now' | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setSettings(await digestApi.getSettings());
    } catch (err) {
      setLoadError(getApiErrorMessage(err, 'Please try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const patch = (p: Partial<DigestSettings>) => setSettings((s) => (s ? { ...s, ...p } : s));
  const toggleSection = (key: keyof DigestSections) =>
    setSettings((s) => (s ? { ...s, sections: { ...s.sections, [key]: !s.sections[key] } } : s));

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const saved = await digestApi.updateSettings({ enabled: settings.enabled, dayOfWeek: settings.dayOfWeek, hour: settings.hour, sections: settings.sections });
      setSettings(saved);
      toast({ title: 'Settings saved' });
    } catch (err) {
      toast({ title: 'Could not save', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const send = async (kind: 'test' | 'now') => {
    setSending(kind);
    try {
      const res = kind === 'test' ? await digestApi.sendTest() : await digestApi.sendNow();
      toast({ title: kind === 'test' ? 'Test email sent to you' : `Digest sent to ${res.sent} members` });
    } catch (err) {
      toast({ title: 'Send failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setSending(null);
    }
  };

  const header = <AdminPageHeader title="Communications" icon={Mail} description="Control the weekly digest email sent to members." />;

  if (loading && !settings) {
    return (
      <div className="space-y-6">
        {header}
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" /></div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        {header}
        <AdminErrorState title="Could not load the digest settings" message={loadError ?? 'Please try again.'} onRetry={() => void load()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5 text-primary" aria-hidden /> Weekly digest</CardTitle>
          <CardDescription>A round-up of new jobs, events, videos and requirements. Members can unsubscribe from their settings.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="accent-primary h-4 w-4" />
            <span className="text-sm font-medium">Send the weekly digest automatically</span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="digest-day">Day</Label>
              <select id="digest-day" className={`${selectCls} w-full`} value={settings.dayOfWeek} onChange={(e) => patch({ dayOfWeek: Number(e.target.value) })}>
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="digest-hour">Hour (server time)</Label>
              <select id="digest-hour" className={`${selectCls} w-full`} value={settings.hour} onChange={(e) => patch({ hour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Sections to include</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(Object.keys(SECTION_LABELS) as Array<keyof DigestSections>).map((key) => (
                <label key={key} className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.sections[key]} onChange={() => toggleSection(key)} className="accent-primary h-4 w-4" />
                  <span className="text-sm">{SECTION_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>

          {settings.lastRunAt && <p className="text-xs text-muted-foreground">Last sent {formatDateTime(settings.lastRunAt)}.</p>}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}Save settings</Button>
            <Button variant="outline" onClick={() => void send('test')} disabled={sending !== null}>
              {sending === 'test' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}Send test to me
            </Button>
            <Button variant="outline" onClick={() => { if (window.confirm('Send the digest to all members now?')) void send('now'); }} disabled={sending !== null}>
              {sending === 'now' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}Send now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
