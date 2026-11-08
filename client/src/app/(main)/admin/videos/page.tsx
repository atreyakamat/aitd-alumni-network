'use client';

import * as React from 'react';
import { Check, Clapperboard, Eye, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { mediaSrc } from '@/lib/social';
import { videosApi, type CollegeVideo, type VideoStatus } from '@/lib/videos';
import { SubmitVideoDialog } from '@/components/videos/SubmitVideoDialog';

const TABS: Array<{ key: VideoStatus; label: string }> = [
  { key: 'PENDING', label: 'Awaiting review' },
  { key: 'APPROVED', label: 'Published' },
  { key: 'REJECTED', label: 'Rejected' },
];

export default function AdminVideosPage() {
  const { toast } = useToast();
  const [status, setStatus] = React.useState<VideoStatus>('PENDING');
  const [videos, setVideos] = React.useState<CollegeVideo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await videosApi.list({ status, limit: 50 });
      setVideos(res.items ?? []);
    } catch (err) {
      toast({ title: 'Could not load videos', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [status, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusyId(id);
    try {
      await fn();
      toast({ title: success });
      setVideos((prev) => prev.filter((v) => v.id !== id));
    } catch (err) {
      toast({ title: 'Action failed', description: getApiErrorMessage(err, ''), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  const approve = (id: string) => act(id, () => videosApi.approve(id), 'Video published');
  const remove = (id: string) => {
    if (!window.confirm('Delete this video permanently?')) return;
    void act(id, () => videosApi.remove(id), 'Video deleted');
  };
  const reject = (id: string) => {
    const reason = window.prompt('Reason for rejecting this video (optional):') ?? undefined;
    void act(id, () => videosApi.reject(id, reason), 'Video rejected');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">College Videos</h1>
          <p className="text-muted-foreground">Review member submissions and publish college videos.</p>
        </div>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden /> Upload video
        </Button>
      </div>

      <div role="tablist" className="flex w-fit gap-1 rounded-lg border bg-card p-1">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={status === key}
            onClick={() => setStatus(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${status === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
        </div>
      ) : videos.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">Nothing here right now.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {videos.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
                <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-md bg-muted sm:w-48">
                  {v.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- user upload
                    <img src={mediaSrc(v.thumbnailUrl)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center"><Clapperboard className="h-8 w-8 text-primary/40" aria-hidden /></div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium">{v.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    by {v.submittedBy?.fullName ?? 'Unknown'} · {new Date(v.createdAt).toLocaleDateString()}
                  </p>
                  {v.category && <Badge variant="secondary" className="mt-1">{v.category}</Badge>}
                  {v.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{v.description}</p>}
                  <a href={mediaSrc(v.videoUrl)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    <Eye className="h-3.5 w-3.5" aria-hidden /> Preview
                  </a>
                </div>
                <div className="flex shrink-0 gap-2">
                  {status === 'PENDING' && (
                    <>
                      <Button size="sm" disabled={busyId === v.id} onClick={() => void approve(v.id)}>
                        <Check className="mr-1 h-4 w-4" aria-hidden /> Approve
                      </Button>
                      <Button size="sm" variant="outline" disabled={busyId === v.id} onClick={() => reject(v.id)}>
                        <X className="mr-1 h-4 w-4" aria-hidden /> Reject
                      </Button>
                    </>
                  )}
                  <Button size="icon" variant="ghost" disabled={busyId === v.id} onClick={() => remove(v.id)} aria-label="Delete video">
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SubmitVideoDialog open={uploadOpen} onOpenChange={setUploadOpen} isAdmin onSuccess={() => void load()} />
    </div>
  );
}
