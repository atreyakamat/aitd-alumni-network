'use client';

import * as React from 'react';
import { Clapperboard, Eye, Loader2, Plus, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { isAdmin as hasAdminRole } from '@/lib/roles';
import { getApiErrorMessage } from '@/lib/api';
import { mediaSrc } from '@/lib/social';
import { videosApi, type CollegeVideo, type VideoStatus } from '@/lib/videos';
import { SubmitVideoDialog } from '@/components/videos/SubmitVideoDialog';

const STATUS_BADGE: Record<VideoStatus, { label: string; className: string }> = {
  APPROVED: { label: 'Published', className: 'bg-success text-white' },
  PENDING: { label: 'Awaiting review', className: 'bg-gold text-gold-foreground' },
  REJECTED: { label: 'Not approved', className: 'bg-destructive text-white' },
};

function VideoCard({ video, onPlay, showStatus }: { video: CollegeVideo; onPlay: (v: CollegeVideo) => void; showStatus?: boolean }) {
  const badge = STATUS_BADGE[video.status];
  return (
    <Card className="group overflow-hidden">
      <button type="button" onClick={() => onPlay(video)} className="relative block aspect-video w-full overflow-hidden bg-muted" aria-label={`Play ${video.title}`}>
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded, arbitrary host
          <img src={mediaSrc(video.thumbnailUrl)} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-primary/5">
            <Clapperboard className="h-10 w-10 text-primary/40" aria-hidden />
          </div>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/20">
          <PlayCircle className="h-12 w-12 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100" aria-hidden />
        </span>
        {showStatus && <Badge className={`absolute left-2 top-2 ${badge.className}`}>{badge.label}</Badge>}
      </button>
      <CardContent className="space-y-1 p-3">
        <h3 className="line-clamp-1 font-medium">{video.title}</h3>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="line-clamp-1">{video.submittedBy?.fullName ?? 'AIEM'}</span>
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" aria-hidden /> {video.viewCount}
          </span>
        </div>
        {video.category && <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{video.category}</span>}
        {showStatus && video.status === 'REJECTED' && video.rejectionReason && (
          <p className="text-xs text-destructive">Reason: {video.rejectionReason}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function VideosPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const admin = hasAdminRole(user?.role);
  const [tab, setTab] = React.useState<'all' | 'mine'>('all');
  const [videos, setVideos] = React.useState<CollegeVideo[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState<CollegeVideo | null>(null);
  const [submitOpen, setSubmitOpen] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = tab === 'mine' ? await videosApi.mine({ limit: 24 }) : await videosApi.list({ limit: 24 });
      setVideos(res.items ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load videos.'));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const onPlay = async (v: CollegeVideo) => {
    setPlaying(v);
    // Fire-and-forget view count for approved videos
    if (v.status === 'APPROVED') {
      try {
        await videosApi.get(v.id);
      } catch {
        /* view count is best-effort */
      }
    }
  };

  return (
    <div className="container max-w-6xl space-y-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-headline text-3xl text-primary">Videos</h1>
          <p className="text-muted-foreground">Campus moments, convocations, lectures and student life.</p>
        </div>
        {user && (
          <Button onClick={() => setSubmitOpen(true)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            {admin ? 'Upload video' : 'Submit a video'}
          </Button>
        )}
      </div>

      {user && (
        <div role="tablist" className="flex w-fit gap-1 rounded-lg border bg-card p-1">
          {([['all', 'All videos'], ['mine', 'My submissions']] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`rounded-md px-3 py-1 text-sm font-medium ${tab === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Loading" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center">
            <p className="text-destructive">{error}</p>
            <Button variant="outline" onClick={() => void load()}>Try again</Button>
          </CardContent>
        </Card>
      ) : videos.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {tab === 'mine' ? 'You haven’t submitted any videos yet.' : 'No videos yet. Check back soon.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} onPlay={onPlay} showStatus={tab === 'mine'} />
          ))}
        </div>
      )}

      <Dialog open={playing !== null} onOpenChange={(o) => !o && setPlaying(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="line-clamp-1">{playing?.title}</DialogTitle>
          </DialogHeader>
          {playing && (
            <div className="space-y-3">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user content, no captions available */}
              <video src={mediaSrc(playing.videoUrl)} poster={playing.thumbnailUrl ? mediaSrc(playing.thumbnailUrl) : undefined} controls autoPlay className="max-h-[70vh] w-full rounded-md bg-black" />
              {playing.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{playing.description}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SubmitVideoDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        isAdmin={admin}
        onSuccess={() => {
          toast({ title: admin ? 'Published' : 'Submitted' });
          if (tab === 'mine' || admin) void load();
        }}
      />
    </div>
  );
}
