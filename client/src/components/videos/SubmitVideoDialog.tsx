'use client';

import * as React from 'react';
import { Loader2, Upload, Video as VideoIcon, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import { videosApi, validateVideoFile, VIDEO_CATEGORIES } from '@/lib/videos';

/** A quick image sniff so we fail fast before uploading a non-image thumbnail. */
function validateThumb(file: File): string | null {
  if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return 'Thumbnail must be a JPG, PNG, GIF or WebP image.';
  if (file.size > 5 * 1024 * 1024) return 'Thumbnail must be 5 MB or smaller.';
  return null;
}

export function SubmitVideoDialog({
  open,
  onOpenChange,
  isAdmin = false,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Admin uploads publish immediately; members submit for review. */
  isAdmin?: boolean;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setDescription('');
    setCategory('');
    setVideoUrl(null);
    setThumbnailUrl(null);
    setProgress(0);
    setError(null);
  };

  const close = (next: boolean) => {
    if (uploading || submitting) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const onVideoPick = async (file?: File) => {
    if (!file) return;
    const invalid = validateVideoFile(file);
    if (invalid) return setError(invalid);
    setError(null);
    setUploading(true);
    setProgress(0);
    try {
      const { videoUrl: url } = await videosApi.uploadFile(file, setProgress);
      setVideoUrl(url);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not upload the video.'));
    } finally {
      setUploading(false);
    }
  };

  const onThumbPick = async (file?: File) => {
    if (!file) return;
    const invalid = validateThumb(file);
    if (invalid) return setError(invalid);
    setError(null);
    try {
      const { url } = await videosApi.uploadThumbnail(file);
      setThumbnailUrl(url);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not upload the thumbnail.'));
    }
  };

  const canSubmit = title.trim().length > 0 && Boolean(videoUrl) && !uploading && !submitting;

  const submit = async () => {
    if (!canSubmit || !videoUrl) return;
    setSubmitting(true);
    setError(null);
    try {
      await videosApi.create({
        title: title.trim(),
        description: description.trim() || undefined,
        category: category || undefined,
        videoUrl,
        thumbnailUrl,
      });
      toast({
        title: isAdmin ? 'Video published' : 'Submitted for review',
        description: isAdmin ? 'It is now live on the Videos page.' : 'An admin will review it shortly.',
      });
      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not submit the video.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isAdmin ? 'Upload a college video' : 'Submit a video'}</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? 'This will be published to the Videos page and the community will be notified.'
              : 'Share a campus moment. An admin will review it before it goes live.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="video-title">Title</Label>
            <Input id="video-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Convocation 2026 highlights" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="video-category">Category (optional)</Label>
            <select
              id="video-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">No category</option>
              {VIDEO_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="video-desc">Description (optional)</Label>
            <Textarea id="video-desc" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} placeholder="A short description…" />
          </div>

          <div className="space-y-2">
            <Label>Video file</Label>
            {videoUrl ? (
              <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 text-primary">
                  <VideoIcon className="h-4 w-4" aria-hidden /> Video uploaded
                </span>
                <button type="button" onClick={() => setVideoUrl(null)} aria-label="Remove video" className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : (
              <>
                <Button type="button" variant="outline" size="sm" asChild disabled={uploading}>
                  <label className="cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" aria-hidden />
                    {uploading ? 'Uploading…' : 'Choose video (MP4/WebM/MOV, max 100 MB)'}
                    <input type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only" disabled={uploading} onChange={(e) => { void onVideoPick(e.target.files?.[0]); e.target.value = ''; }} />
                  </label>
                </Button>
                {uploading && <Progress value={progress} aria-label="Upload progress" />}
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>Thumbnail (optional)</Label>
            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" aria-hidden />
                {thumbnailUrl ? 'Thumbnail added — replace' : 'Choose a thumbnail image'}
                <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="sr-only" onChange={(e) => { void onThumbPick(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)} disabled={uploading || submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
            {isAdmin ? 'Publish' : 'Submit for review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
