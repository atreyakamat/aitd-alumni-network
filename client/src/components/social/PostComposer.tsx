'use client';

import { useEffect, useRef, useState } from 'react';
import { Clapperboard, Globe2, ImagePlus, Loader2, Lock, Send, Video, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { MentionTextarea } from '@/components/social/MentionTextarea';
import { useAuth } from '@/context/auth-context';
import { useToast } from '@/hooks/use-toast';
import { getApiErrorMessage } from '@/lib/api';
import {
  MAX_POST_IMAGES,
  POST_CONTENT_MAX,
  activeMentionIds,
  extractHashtags,
  mediaSrc,
  socialApi,
  validateVideoFile,
  type MentionRef,
  type PostVisibility,
  type SocialPost,
} from '@/lib/social';
import { cn, getInitials } from '@/lib/utils';

interface PendingImage {
  key: string;
  preview: string;
  url: string | null;
  failed?: boolean;
}

interface PendingVideo {
  preview: string;
  url: string | null;
  progress: number;
  thumbnailUrl: string | null;
  vertical: boolean;
  failed?: boolean;
}

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif';
const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime';

/** Grab a frame ~0.5 s in as a JPEG poster. Best effort: resolves null when the browser can't. */
export function capturePosterFrame(file: File): Promise<{ blob: Blob | null; vertical: boolean }> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return resolve({ blob: null, vertical: false });
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const done = (result: { blob: Blob | null; vertical: boolean }) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    const timer = window.setTimeout(() => done({ blob: null, vertical: false }), 8000);
    video.muted = true;
    video.preload = 'metadata';
    video.src = url;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    };
    video.onseeked = () => {
      try {
        const vertical = video.videoHeight > video.videoWidth;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx || !canvas.width) {
          window.clearTimeout(timer);
          return done({ blob: null, vertical });
        }
        ctx.drawImage(video, 0, 0);
        canvas.toBlob((blob) => {
          window.clearTimeout(timer);
          done({ blob, vertical });
        }, 'image/jpeg', 0.82);
      } catch {
        window.clearTimeout(timer);
        done({ blob: null, vertical: false });
      }
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      done({ blob: null, vertical: false });
    };
  });
}

export function PostComposer({
  onCreated,
  mode = 'post',
  autoFocus = false,
  className,
  placeholder,
}: {
  onCreated?: (post: SocialPost) => void;
  /** 'reel' starts with the reel toggle on and asks for a video first. */
  mode?: 'post' | 'reel';
  autoFocus?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [mentions, setMentions] = useState<MentionRef[]>([]);
  const [images, setImages] = useState<PendingImage[]>([]);
  const [video, setVideo] = useState<PendingVideo | null>(null);
  const [isReel, setIsReel] = useState(mode === 'reel');
  const [visibility, setVisibility] = useState<PostVisibility>('PUBLIC');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => () => previews.current.forEach((p) => URL.revokeObjectURL(p)), []);

  const objectUrl = (file: File) => {
    const url = URL.createObjectURL(file);
    previews.current.push(url);
    return url;
  };

  const hashtags = extractHashtags(content);
  const uploading = images.some((i) => !i.url && !i.failed) || (video !== null && !video.url && !video.failed);
  const trimmed = content.trim();
  const readyImages = images.filter((i) => i.url).map((i) => i.url as string);
  const hasMedia = readyImages.length > 0 || Boolean(video?.url);
  const canSubmit =
    !submitting && !uploading && trimmed.length <= POST_CONTENT_MAX && (trimmed.length > 0 || hasMedia) && (!isReel || Boolean(video?.url));

  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const room = MAX_POST_IMAGES - images.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) toast({ title: `You can add up to ${MAX_POST_IMAGES} images` });
    if (picked.length === 0) return;
    const pending = picked.map((file, i) => ({ key: `${Date.now()}-${i}-${file.name}`, preview: objectUrl(file), url: null }));
    setImages((prev) => [...prev, ...pending]);
    try {
      const urls = await socialApi.uploadImages(picked);
      setImages((prev) =>
        prev.map((img) => {
          const idx = pending.findIndex((p) => p.key === img.key);
          return idx >= 0 ? { ...img, url: urls.at(idx) ?? null, failed: !urls.at(idx) } : img;
        })
      );
    } catch (err) {
      setImages((prev) => prev.filter((img) => !pending.some((p) => p.key === img.key)));
      setError(getApiErrorMessage(err, 'Could not upload the images.'));
    }
  };

  const addVideo = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const invalid = validateVideoFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setImages([]);
    setVideo({ preview: objectUrl(file), url: null, progress: 0, thumbnailUrl: null, vertical: false });
    const posterTask = capturePosterFrame(file).then(async ({ blob, vertical }) => {
      if (vertical && mode !== 'reel') setIsReel(true);
      setVideo((v) => (v ? { ...v, vertical } : v));
      if (!blob) return;
      try {
        const [thumb] = await socialApi.uploadImages([new File([blob], 'poster.jpg', { type: 'image/jpeg' })]);
        setVideo((v) => (v ? { ...v, thumbnailUrl: thumb ?? null } : v));
      } catch {
        // The video still works without a poster.
      }
    });
    try {
      const uploaded = await socialApi.uploadVideo(file, (progress) => setVideo((v) => (v ? { ...v, progress } : v)));
      setVideo((v) => (v ? { ...v, url: uploaded.url, progress: 100 } : v));
    } catch (err) {
      setVideo(null);
      setError(getApiErrorMessage(err, 'Could not upload the video.'));
    }
    await posterTask;
  };

  const reset = () => {
    setContent('');
    setMentions([]);
    setImages([]);
    setVideo(null);
    setIsReel(mode === 'reel');
    setError(null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const post = await socialApi.createPost({
        content: trimmed,
        mediaUrls: readyImages,
        ...(video?.url ? { videoUrl: video.url, thumbnailUrl: video.thumbnailUrl, isReel } : {}),
        visibility,
        mentionIds: activeMentionIds(content, mentions),
      });
      reset();
      onCreated?.(post);
      toast({ title: isReel ? 'Reel posted' : 'Posted', description: visibility === 'CONNECTIONS' ? 'Visible to your connections.' : undefined });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not publish your post. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!user) return null;
  const remaining = POST_CONTENT_MAX - content.length;

  return (
    <div className={cn('rounded-lg border bg-card p-4 shadow-sm', className)}>
      <div className="flex gap-3">
        <Avatar className="h-10 w-10 shrink-0">
          <AvatarImage src={mediaSrc(user.avatarUrl) || undefined} alt="" />
          <AvatarFallback className="bg-primary/10 text-primary">{getInitials(user.fullName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-3">
          <MentionTextarea
            value={content}
            onChange={setContent}
            mentions={mentions}
            onMentionsChange={setMentions}
            ariaLabel={mode === 'reel' ? 'Reel caption' : 'Write a post'}
            placeholder={placeholder ?? (mode === 'reel' ? 'Add a caption… use #tags and @mentions' : 'Share an update, a win or a question with fellow alumni…')}
            maxLength={POST_CONTENT_MAX}
            autoFocus={autoFocus}
            className="min-h-[80px] border-0 bg-muted/40 focus-visible:ring-1"
            onSubmitShortcut={submit}
            disabled={submitting}
          />

          {hashtags.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label="Hashtags in this post">
              {hashtags.map((t) => (
                <li key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">#{t}</li>
              ))}
            </ul>
          )}

          {images.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Attached images">
              {images.map((img, i) => (
                <li key={img.key} className="relative aspect-square overflow-hidden rounded-md bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img src={img.preview} alt={`Attachment ${i + 1}`} className={cn('h-full w-full object-cover', !img.url && 'opacity-50')} />
                  {!img.url && !img.failed && <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-primary" aria-label="Uploading" />}
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((p) => p.key !== img.key))}
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {video && (
            <div className="space-y-2">
              <div className={cn('relative overflow-hidden rounded-md bg-black', video.vertical ? 'mx-auto max-w-[220px]' : '')}>
                <video src={video.preview} muted playsInline controls className="max-h-72 w-full" aria-label="Video preview" />
                <button
                  type="button"
                  onClick={() => {
                    setVideo(null);
                    setIsReel(mode === 'reel');
                  }}
                  aria-label="Remove video"
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              {!video.url && (
                <div className="space-y-1">
                  <Progress value={video.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={video.progress} aria-label="Video upload progress" />
                  <p className="text-xs text-muted-foreground">Uploading video… {video.progress}%</p>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={isReel} onChange={(e) => setIsReel(e.target.checked)} className="accent-primary" />
                <Clapperboard className="h-4 w-4 text-primary" aria-hidden="true" />
                Post as a reel {video.vertical && <span className="text-xs text-muted-foreground">(vertical video detected)</span>}
              </label>
            </div>
          )}

          {mode === 'reel' && !video && (
            <p className="text-sm text-muted-foreground">Reels are short vertical videos. Choose a video to get started.</p>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div className="flex items-center gap-1">
              <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={(e) => { void addImages(e.target.files); e.target.value = ''; }} data-testid="composer-image-input" />
              <input ref={videoInput} type="file" accept={VIDEO_ACCEPT} hidden onChange={(e) => { void addVideo(e.target.files?.[0]); e.target.value = ''; }} data-testid="composer-video-input" />
              {mode === 'post' && (
                <Button type="button" variant="ghost" size="sm" onClick={() => imageInput.current?.click()} disabled={submitting || Boolean(video) || images.length >= MAX_POST_IMAGES} aria-label="Add photos">
                  <ImagePlus className="mr-1.5 h-4 w-4 text-green-600" aria-hidden="true" />
                  <span className="hidden sm:inline">Photo</span>
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" onClick={() => videoInput.current?.click()} disabled={submitting || Boolean(video) || images.length > 0} aria-label="Add a video">
                <Video className="mr-1.5 h-4 w-4 text-blue-600" aria-hidden="true" />
                <span className="hidden sm:inline">{mode === 'reel' ? 'Choose video' : 'Video'}</span>
              </Button>
              <label className="sr-only" htmlFor="composer-visibility">Who can see this</label>
              <span className="flex items-center gap-1 rounded-md px-2 text-sm text-muted-foreground">
                {visibility === 'PUBLIC' ? <Globe2 className="h-4 w-4" aria-hidden="true" /> : <Lock className="h-4 w-4" aria-hidden="true" />}
                <select
                  id="composer-visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as PostVisibility)}
                  className="bg-transparent py-1 text-sm focus:outline-none"
                >
                  <option value="PUBLIC">Anyone</option>
                  <option value="CONNECTIONS">Connections</option>
                </select>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={cn('text-xs', remaining < 200 ? 'text-destructive' : 'text-muted-foreground')} aria-live="polite">
                {remaining < 500 ? `${remaining} left` : ''}
              </span>
              <Button type="button" onClick={submit} disabled={!canSubmit} size="sm">
                {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
                {mode === 'reel' || isReel ? 'Share reel' : 'Post'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
